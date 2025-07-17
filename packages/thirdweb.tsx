/* eslint react-hooks/exhaustive-deps: error */
import { useCallback, useMemo } from 'react';
import { type Chain, createThirdwebClient, defineChain } from 'thirdweb';
import {
    type UseConnectModalOptions,
    useActiveAccount,
    useActiveWallet,
    useActiveWalletChain,
    useAutoConnect,
    useConnectModal,
    useConnectedWallets,
    useDisconnect,
    useSetActiveWallet,
} from 'thirdweb/react';
import { type Account, type Wallet, createWallet, inAppWallet } from 'thirdweb/wallets';

import type { MutationResult } from '../graphql/generated/graphql';
import { THIRDWEB_CLIENT_ID } from './config';

export { ThirdwebProvider } from 'thirdweb/react';

export const DEFAULT_CHAIN =
    {
        development: defineChain(11155111),
        production: defineChain(1),
    }[process.env.NEXT_PUBLIC_VERCEL_ENV ?? 'development'] ?? defineChain(11155111);

export const appMetadata = {
    name: '',
    url: '',
    description: '',
    logoUrl: '',
};

export const client = createThirdwebClient({
    clientId: THIRDWEB_CLIENT_ID,
});

export const connectOptions = {
    client,
} satisfies UseConnectModalOptions;

export const inAppWalletOptions = [
    inAppWallet({
        auth: {
            options: ['google', 'apple', 'email'],
        },
    }),
];

export const externalWalletOptions = [
    createWallet('io.metamask'),
    createWallet('com.coinbase.wallet'),
    createWallet('walletConnect'),
];

export const roninWalletId = 'com.roninchain.wallet';
export const roninWalletOption = [createWallet(roninWalletId)];

export function useWallets() {
    const { isLoading } = useAutoConnect({
        appMetadata,
        client,
        wallets: inAppWalletOptions,
    });

    const chain = useActiveWalletChain();
    const { connect: evmConnect, isConnecting } = useConnectModal();
    const { disconnect: evmDisconnect } = useDisconnect();
    const wallet = useActiveWallet();
    const wallets = useConnectedWallets();
    const account = useActiveAccount();
    const setActiveWallet = useSetActiveWallet();

    const connect = useCallback(
        (props?: Omit<UseConnectModalOptions, keyof typeof connectOptions>) => {
            return evmConnect({
                ...connectOptions,
                wallets: externalWalletOptions,
                ...props,
                size: 'compact',
                showThirdwebBranding: false,
            });
        },
        [evmConnect],
    );

    const disconnect = useCallback(
        (targetWallet: Wallet | undefined = wallet) => {
            if (!targetWallet) return;
            evmDisconnect(targetWallet);
        },
        [evmDisconnect, wallet],
    );

    return useMemo(
        () => ({
            account,
            chain: chain ?? DEFAULT_CHAIN,
            connect,
            connected: Boolean(account),
            disconnect,
            connecting: isConnecting || isLoading,
            setActiveWallet,
            wallet,
            wallets,
        }),
        [
            account,
            chain,
            connect,
            disconnect,
            isConnecting,
            isLoading,
            setActiveWallet,
            wallet,
            wallets,
        ],
    );
}

export async function signInWithEVM({
    chain,
    wallet,
    input: initialInput,
    verify,
}: {
    chain: Chain;
    input:
        | Parameters<Account['signTypedData']>[0]
        | ((account: Account) => Promise<Parameters<Account['signTypedData']>[0]>);
    verify: (args: {
        account: Account;
        signature: string;
        wallet: Wallet;
    }) => Promise<MutationResult>;
    wallet: Wallet;
}): Promise<MutationResult> {
    chain ??= DEFAULT_CHAIN;

    const account = wallet.getAccount();

    if (!account) {
        throw new Error('Cannot connect a wallet without an account.');
    }

    const input = typeof initialInput === 'function' ? await initialInput(account) : initialInput;
    const signature = await account.signTypedData(input);

    return verify({ account, signature, wallet });
}
