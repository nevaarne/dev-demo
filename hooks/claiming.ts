/* eslint react-hooks/exhaustive-deps: error */
import { useMutation, useQuery } from '@apollo/client';
import { useCallback, useMemo } from 'react';

import { useAccount } from '../packages/account';
import captureException from '@monorepo/shared/utils/capture-exception';

import { gql } from './generated';
import { GET_ONBOARDING_WALLETS } from './onboarding-wallets';

const CLAIM_ALLOCATION_TOKENS_MUTATION = gql(`
    mutation ClaimAllocationTokens ($walletAddress: EthereumAddress) {
        claimAllocationTokens (walletAddress: $walletAddress) {
            success
            message
        }
    }
`);

const CLAIM_STAKING_REWARDS_MUTATION = gql(`
    mutation ClaimStakingRewards ($walletAddress: EthereumAddress) {
        claimStakingRewards (walletAddress: $walletAddress) {
            success
            message
        }
    }
`);

export const useClaimAllocationTokens = (walletAddress?: string) => {
    return useMutation(CLAIM_ALLOCATION_TOKENS_MUTATION, {
        variables: { walletAddress },
        awaitRefetchQueries: true,
        refetchQueries: [GET_ONBOARDING_WALLETS],
    });
};

const CLAIMS_QUERY = gql(`
    query Claims {
        getGameUser {
            id

            lastAllocationClaim {
                id
                status
                txnHash
                timestamp
                receipt{
                    status
                }
            }

            smth {
                tokens
                season1Tokens
                season2Tokens
            }

            connectedWallets {
                id
                address
                walletId
                accruedStakeTokens
                accruedStakeTokens
                claimedTokens
                pendingClaimedTokens

                WalletStats {
                    numAllocations
                    totalAllocated
                }
            }

            dailyInfo {
                canClaimTokens
            }
        }
    }
`);

export function useClaims() {
    const { isAuthenticated } = useAccount();
    const claimsQuery = useQuery(CLAIMS_QUERY, {
        fetchPolicy: 'cache-and-network',
        skip: !isAuthenticated,
    });

    const [claimAllocationMutation, claimAllocationMutationData] = useMutation(
        CLAIM_ALLOCATION_TOKENS_MUTATION,
        {
            awaitRefetchQueries: true,
            refetchQueries: [CLAIMS_QUERY],
        },
    );

    const [claimStakingRewardsMutation, claimStakingRewardsMutationData] = useMutation(CLAIM_STAKING_REWARDS_MUTATION, {
        awaitRefetchQueries: true,
        refetchQueries: [CLAIMS_QUERY],
    });

    const claim = useCallback(
        async (
            mutation:
                | typeof claimAllocationMutation
                | typeof claimStakingRewardsMutation,
            walletAddress?: string,
        ): Promise<[undefined, string] | [Error, undefined]> => {
            const wallet = (claimsQuery.data?.getGameUser?.connectedWallets ?? []).find(
                (wallet) => wallet.address === walletAddress,
            );

            if (walletAddress && !wallet) {
                return [
                    new Error(
                        `Invalid wallet address: ${walletAddress} not in user connected wallets.`,
                    ),
                    undefined,
                ];
            }

            const { data } = await mutation({ variables: { walletAddress } });
            const result = (() => {
                switch (true) {
                    case 'claimAllocationTokens' in data:
                        return data.claimAllocationTokens;
                    case 'claimStakingRewards' in data:
                        return data.claimStakingRewards;
                    default:
                        throw new Error('Unsupported field.');
                }
            })();

            if ('error' in result) captureException(result.error, { id: '' });

            return result?.success
                ? [undefined, result.message]
                : [new Error(result?.message ?? 'Operation error.'), undefined];
        },
        [claimsQuery.data],
    );

    const claimAllocation = useCallback(
        (walletAddress?: string) => claim(claimAllocationMutation, walletAddress),
        [claim, claimAllocationMutation],
    );

    const claimStakingRewards = useCallback(
        (walletAddress?: string) => claim(claimStakingRewardsMutation, walletAddress),
        [claim, claimStakingRewardsMutation],
    );

    const aggregates = useMemo(() => {
        return (claimsQuery.data?.getGameUser?.connectedWallets ?? []).reduce(
            (aggregates, wallet) => {
                for (const field in aggregates) {
                    if (typeof wallet[field] !== 'number') continue;
                    aggregates[field] += wallet[field];
                }
                
                aggregates.numAllocations += wallet.WalletStats.numAllocations;
                aggregates.totalAllocated += wallet.WalletStats.totalAllocated;

                return aggregates;
            },
            {
                ...claimsQuery.data?.getGameUser,
                accruedStakeTokens: 0,
                accruedStakeTokens: 0,
                campaignTokens:
                    (claimsQuery.data?.getGameUser?.season1Tokens ?? 0) +
                    (claimsQuery.data?.getGameUser?.season2Tokens ?? 0) +
                    (claimsQuery.data?.getGameUser?.socialfiTokens ?? 0),
                claimedTokens: 0,
                numAllocations: 0,
                pendingClaimedTokens: 0,
                totalAllocated: 0,
            },
        );
    }, [claimsQuery.data]);

    const lastClaimPending = useMemo(() => {
        const lastAllocationClaim = claimsQuery?.data?.getGameUser.lastAllocationClaim;
        if (!lastAllocationClaim) return false;

        const isPending = lastAllocationClaim.status === 'pending';
        if (!isPending) return false;

        const claimTime = new Date(lastAllocationClaim.timestamp + 'Z' || 0);
        const now = new Date();
        const diff = Number(now) - Number(claimTime);
        const minutes = diff / 1000 / 60;

        if (minutes < 5) return true;
        return !!lastAllocationClaim.receipt;
    }, [claimsQuery]);

    return useMemo(
        () => ({
            aggregates,
            lastClaimPending,
            claimsQuery,
            claimAllocation,
            claimAllocationMutationData,
            claimStakingRewards,
            claimStakingRewardsMutationData,
        }),
        [
            aggregates,
            lastClaimPending,
            claimsQuery,
            claimAllocation,
            claimAllocationMutationData,
            claimStakingRewards,
            claimStakingRewardsMutationData,
        ],
    );
}
