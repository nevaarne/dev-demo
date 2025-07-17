import { type MutationResult, type QueryResult, useMutation, useQuery } from '@apollo/client';
import {
    type ReactNode,
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
} from 'react';
import { type Chain } from 'thirdweb';
import type { Wallet } from 'thirdweb/wallets';

import captureException from '@monorepo/shared/utils/capture-exception';

import { getFragment, gql } from '../graphql/generated';
import {
    type MutationResult as APIMutationResult,
    type AccountDataFragment,
    type AccountQuery,
    type AccountQueryVariables,
    ChainType,
    type SetAirdropWalletMutation,
    type TwitterDataFragment,
} from '../graphql/generated/graphql';
import { useLogin } from './jwt';
import {
    DEFAULT_CHAIN,
    connectOptions,
    externalWalletOptions,
    inAppWalletOptions,
    signInWithEVM,
    useWallets,
} from './thirdweb';
import { TWITTER_FRAGMENT, useTwitter } from './twitter';

const ACCOUNT_FRAGMENT = gql(`
  fragment AccountData on GameUser {
    id
    connectedWallets {
      id
      address
      chainType
      delegatedWallets
      isAirdropWallet
      walletId
    }
  }
`);

export const ACCOUNT_QUERY = gql(`
  query Account {
    getGameUser {
      id
      ...AccountData
      ...TwitterData
    }
  }
`);

const CONNECT_WALLET_TO_GAME_USER = gql(`
  mutation ConnectWalletToGameUser(
      $chainType: ChainType!
      $signature: String!
      $signedData: String
      $timestamp: Int!
      $walletAddress: String!
      $walletId: String
  ) {
      connectWalletToGameUser(
          chainType: $chainType
          signature: $signature
          signedData: $signedData
          timestamp: $timestamp
          walletAddress: $walletAddress
          walletId: $walletId
      ) {
          success
          message
      }
  }
`);

const DISCONNECT_WALLET_FROM_GAME_USER = gql(`
  mutation DisconnectWalletFromGameUser($walletAddress: String!) {
      disconnectWalletFromGameUser(walletAddress: $walletAddress) {
          success
          message
      }
  }
`);

const SET_AIRDROP_WALLET = gql(`
  mutation SetAirdropWallet($walletAddress: EthereumAddress!) {
    setAirdropWallet(walletAddress: $walletAddress) {
      message
      success
    }
  }
`);

type ConnectWalletOptions =
    { networkType: 'evm'; chain?: Chain; wallets?: Wallet[] }

export type AccountContext = {
    connect: (args?: { chain?: Chain; wallets?: Wallet[] }) => Promise<boolean>;
    connectTwitter: () => Promise<void>;
    connectWallet: (args: ConnectWalletOptions) => Promise<APIMutationResult>;
    disconnect: () => void;
    disconnectTwitter: () => Promise<void>;
    disconnectWallet: (walletAddress: string) => Promise<void>;
    gameUser?: AccountDataFragment & TwitterDataFragment;
    twitterConnectRes: APIMutationResult;
    isAuthenticating: boolean;
    isAuthenticated: boolean;
    isTwitterConnecting: boolean;
    isTwitterDisconnecting: boolean;
    isWalletConnecting: boolean;
    isWalletDisconnecting: boolean;
    isExternalWalletConnected: boolean;
    queryResult: Omit<QueryResult<AccountQuery, AccountQueryVariables>, 'data'>;
    evm: ReturnType<typeof useWallets>;
    setAirdropWallet: (
        walletAddress: string,
    ) => Promise<[error: Error | undefined, success: boolean]>;
    setAirdropWalletMutationResult: MutationResult<SetAirdropWalletMutation>;
};

const context = createContext<AccountContext | undefined>(undefined);

export function useAccount() {
    const ctx = useContext(context);
    if (!ctx) throw new Error('Unable to find parent "AccountProvider".');
    return ctx;
}

/**
 * Sets up everything necessary to manage "Accounts".
 *
 * You can consume this context through the `useAccount()` hook.
 *
 * Because we have multiple apps with multiple requirements for `gameUser` data,
 * initializing the `AccountProvider` requires you to pass in a query definition
 * which queries for `gameUser`. The query in question needs to support the fields
 * required by the `AccountData` and `TwitterData` fragments.
 *
 * @param query - The query which provides `gameUser` data.
 * @param children - Any `ReactNode` tree which will be able to access this provider.
 */
export function AccountProvider({
    children,
    onError,
}: {
    children: ReactNode;
    onError?: (error: Error) => void;
}) {
    const [isAuthenticating, setIsAuthenticating] = useState(false);
    const [isWalletConnecting, setIsWalletConnecting] = useState(false);
    const [isWalletDisconnecting, setIsWalletDisconnecting] = useState(false);

    const evm = useWallets();
    const {
        isAuthenticated,
        isAuthenticating: isJwtAuthenticating,
        login,
        logout,
    } = useLogin({
        onError: () => {
            if (!evm.wallet) return;
            evm.disconnect(evm.wallet);
        },
    });
    const { data, ...queryResult } = useQuery(ACCOUNT_QUERY, {
        fetchPolicy: 'network-only',
        skip: !isAuthenticated,
        onError: console.warn,
    });

    const twitter = useTwitter({ data, query: ACCOUNT_QUERY });

    const [connectWalletToGameUser] = useMutation(CONNECT_WALLET_TO_GAME_USER, {
        awaitRefetchQueries: true,
        refetchQueries: [ACCOUNT_QUERY],
    });
    const [disconnectWalletFromGameUser] = useMutation(DISCONNECT_WALLET_FROM_GAME_USER, {
        awaitRefetchQueries: true,
        refetchQueries: [ACCOUNT_QUERY],
    });
    const [setAirdropWalletMutation, setAirdropWalletMutationResult] = useMutation(
        SET_AIRDROP_WALLET,
        {
            awaitRefetchQueries: true,
            refetchQueries: [ACCOUNT_QUERY],
        },
    );

    const gameUser = data?.getGameUser
        ? Object.assign(
              {},
              getFragment(ACCOUNT_FRAGMENT, data?.getGameUser),
              getFragment(TWITTER_FRAGMENT, data?.getGameUser),
          )
        : undefined;

    const userOwnsWalletAddress = useCallback(
        (accountAddress: string) =>
            gameUser?.connectedWallets.some(
                ({ address }) =>
                    (address as string).toLowerCase() === accountAddress.toLowerCase(),
            ) ?? false,
        [gameUser],
    );

    /**
     * Disconnect a wallet from the website.
     */
    const disconnect = useCallback(() => {
        // We can safely call `logout()` as it currently only removes a locally
        // stored JWT and signature.
        logout();
        if (evm.wallet) evm.disconnect(evm.wallet);
    }, [evm, logout]);

    /**
     * Connect an account to the website.
     *
     * By default `connect()` will have users connect with their email through
     * the `inApp` wallet. This will authenticate users with our back end.
     *
     * Passing other `wallets`, like `externalWalletOptions` to this method
     * will not authenticate users and just initialize a wallet connection
     * through Thirdweb.
     */
    const connect = useCallback<AccountContext['connect']>(
        async ({ chain, wallets } = {}) => {
            chain ??= DEFAULT_CHAIN;
            wallets ??= inAppWalletOptions;

            setIsAuthenticating(true);
            try {
                const wallet = await evm.connect({
                    ...connectOptions,
                    chain,
                    wallets,
                });

                // HACK: we might want more control over this behavior
                if (wallet.id === 'inApp') await login(wallet);
                return true;
            } catch (error) {
                disconnect();
                captureException(error, { id: 'thirdweb_login' });
                if (error instanceof Error) onError?.(error);
                return false;
            } finally {
                setIsAuthenticating(false);
            }
        },
        [disconnect, evm, login, onError],
    );

    const connectEVMWallet = useCallback(
        async (
            { chain, wallets }: Extract<ConnectWalletOptions, { networkType: 'evm' }> = {
                networkType: 'evm',
            },
        ): Promise<APIMutationResult> => {
            chain ??= DEFAULT_CHAIN;
            wallets ??= externalWalletOptions;

            const wallet = await evm.connect({ chain, wallets });

            const account = wallet.getAccount();

            if (!account?.address)
                throw Error(`Cannot link wallet: address is "${account?.address}".`);

            if (userOwnsWalletAddress(account.address))
                return { success: false, message: 'Wallet already connected.' };

            const timestamp = Math.floor(Number(new Date()) / 1000);

            return signInWithEVM({
                chain,
                wallet,
                input: {
                    domain: {
                        name: 'Connect Wallet',
                        version: '1',
                        // Metamask throws undefined error if verifyingContract field is missing
                        verifyingContract: wallet.id === "io.metamask" ? "" : undefined,
                    },
                    types: {
                        Message: [
                            { name: 'purpose', type: 'string' },
                            { name: 'timestamp', type: 'uint256' },
                        ],
                    },
                    primaryType: 'Message',
                    message: {
                        purpose: 'Proof of wallet ownership signature request',
                        timestamp: BigInt(timestamp),
                    },
                },
                verify: async ({ account, signature, wallet }) => {
                    const { data } = await connectWalletToGameUser({
                        variables: {
                            chainType: ChainType.Evm,
                            signature,
                            timestamp,
                            walletAddress: account.address,
                            walletId: wallet.id,
                        },
                    });
                    if (!data?.connectWalletToGameUser?.success) {
                        throw new Error(
                            data?.connectWalletToGameUser?.message ?? 'Operation error.',
                        );
                    }

                    return data.connectWalletToGameUser;
                },
            });
        },
        [connectWalletToGameUser, evm, userOwnsWalletAddress],
    );

    /**
     * Link a wallet to the current signed in account.
     */
    const connectWallet = useCallback<AccountContext['connectWallet']>(
        async (args) => {
            let result = { success: false, message: '' };

            setIsWalletConnecting(true);
            try {
                switch (args.networkType) {
                    case 'evm':
                        result = await connectEVMWallet(args);
                        break;
                    default:
                        throw new Error(
                            'Invariant Violation: connectWallet arguments not supported.',
                        );
                }
            } catch (error) {
                if (error instanceof Error) {
                    captureException(error, { id: 'account.connectWallet' });
                    onError?.(error);
                }
            } finally {
                setIsWalletConnecting(false);
            }

            return result;
        },
        [connectEVMWallet, onError],
    );
    /**
     * Unlink a wallet from an account.
     */
    const disconnectWallet = useCallback<AccountContext['disconnectWallet']>(
        async (walletAddress) => {
            setIsWalletDisconnecting(true);
            const res = await disconnectWalletFromGameUser({ variables: { walletAddress } });
            setIsWalletDisconnecting(false);
            const data = res?.data?.disconnectWalletFromGameUser;
            if (!data?.success) throw new Error(data?.message);
        },
        [disconnectWalletFromGameUser],
    );

    /**
     * Set user's wallet for airdrops.
     */
    const setAirdropWallet = useCallback<AccountContext['setAirdropWallet']>(
        async (walletAddress) => {
            const wallet = gameUser?.connectedWallets?.find(
                (wallet) => wallet.address === walletAddress,
            );

            if (wallet?.isAirdropWallet) return [undefined, false];

            if (!wallet)
                return [
                    new Error(
                        `Invalid wallet address: ${walletAddress} not in user connected wallets.`,
                    ),
                    false,
                ];
            if (wallet.walletId === 'thirdweb')
                return [
                    new Error(`Invalid wallet address: ${wallet.walletId} unsupported walletId.`),
                    false,
                ];

            const { data } = await setAirdropWalletMutation({
                variables: { walletAddress },
            });

            const success = Boolean(data?.setAirdropWallet?.success);
            return success
                ? [undefined, success]
                : [new Error(data?.setAirdropWallet?.message ?? 'Operation error.'), success];
        },
        [gameUser, setAirdropWalletMutation],
    );

    const isExternalWalletConnected = useMemo(() => {
        const isWalletConnected = Boolean(evm.wallet);
        const isExternalWallet = evm.wallet?.id !== 'inApp';
        const hasWalletLinked = (gameUser?.connectedWallets ?? []).some(
            ({ address }) => address === evm.account?.address,
        );
        return isWalletConnected && isExternalWallet && hasWalletLinked;
    }, [gameUser, evm]);

    useEffect(() => {
        if (evm.wallets?.length !== 1) return;
        if (evm.wallets[0]?.id !== 'inApp') return;
        if (evm.wallet === evm.wallets[0]) return;
        evm.setActiveWallet(evm.wallets[0]);
    }, [evm, evm.chain, evm.wallets]);

    const value: AccountContext = useMemo(() => {
        return {
            ...twitter,
            evm,
            connect,
            connectWallet,
            disconnect,
            disconnectWallet,
            gameUser,
            isAuthenticating: isAuthenticating || isJwtAuthenticating,
            isAuthenticated,
            isWalletConnecting,
            isWalletDisconnecting,
            isExternalWalletConnected,
            queryResult,
            setAirdropWallet,
            setAirdropWalletMutationResult,
        };
    }, [
        evm,
        connect,
        connectWallet,
        disconnect,
        disconnectWallet,
        gameUser,
        isAuthenticated,
        isAuthenticating,
        isWalletConnecting,
        isWalletDisconnecting,
        isJwtAuthenticating,
        isExternalWalletConnected,
        queryResult,
        setAirdropWallet,
        setAirdropWalletMutationResult,
        twitter,
    ]);

    return <context.Provider value={value}>{children}</context.Provider>;
}
