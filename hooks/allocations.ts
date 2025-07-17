import { useLazyQuery } from '@apollo/client';
import { useCallback, useMemo, useState } from 'react';

import { useAccount } from '../packages/account';

import { gql } from './generated';
import { GetAllocationsQuery } from './generated/graphql';

const ALLOCATIONS_QUERY = gql(`
    query GetAllocations($cursor: String) {
        getUserAllocations(cursor: $cursor) {
            cursor
            allocations {
                id
                amount
                claimed
                funded
                received
                walletAddress

                category {
                    id
                    name
                }

                claimSchedule {
                    unlocks {
                        available
                        claimed
                        tokenAmount
                        tokenAmount
                        unlockTimestamp
                    }

                    total
                }
            }
        }
    }
`);

let allocationCache:
    | Map<string, GetAllocationsQuery['getUserAllocations']['allocations'][number]>
    | undefined = undefined;

export function useAllocations() {
    const { isAuthenticated } = useAccount();
    const [fetchAllocations, allocationsQuery] = useLazyQuery(ALLOCATIONS_QUERY, {
        fetchPolicy: 'cache-and-network',
    });

    const [allocations, setAllocations] = useState(
        new Map<
            string,
            GetAllocationsQuery['getUserAllocations']['allocations'][number]
        >(),
    );
    const [isLoading, setIsLoading] = useState(false);

    const fetchAllAllocations = useCallback(async () => {
        setIsLoading(true);

        let cursor: string | null | undefined = undefined;
        const fetchedAllocationIds: string[] = [];

        while (typeof cursor === 'undefined' || typeof cursor === 'string') {
            const { data } = await fetchAllocations({
                variables: { cursor },
            });

            fetchedAllocationIds.push(
                ...data.getUserAllocations.allocations.map(({ id }) => id),
            );

            setAllocations((allocations) => {
                for (const allocation of data.getUserAllocations.allocations) {
                    allocations.set(allocation.id, allocation);
                }

                return new Map(allocations);
            });

            cursor = data.getUserAllocations.cursor;
        }

        // after fetching all allocations we need to clear out any entries which
        // we haven't found in the new set.
        setAllocations((allocations) => {
            for (const id of allocations.keys())
                if (!fetchedAllocationIds.includes(id)) allocations.delete(id);

            // ! WARN ! we need to update the allocationCache. This makes it so
            // that this hook does not fire off queries every time it's called.
            return (allocationCache = new Map(allocations));
        });

        setIsLoading(false);
    }, []);

    if (!allocationsQuery.data && isAuthenticated && !isLoading && !allocationCache) {
        fetchAllAllocations();
    }

    return useMemo(() => {
        const allocationsArray = Array.from((allocationCache ?? allocations).values());

        const aggregates = allocationsArray.reduce(
            (aggregates, allocation) => {
                const { name = 'Unknown' } = allocation.category ?? {};
                let entry = aggregates.allocations.get(name);

                if (!entry) {
                    entry = { amount: 0, count: 0, name };
                    aggregates.allocations.set(name, entry);
                }

                aggregates.creditedTokens += allocation.amount;

                entry.amount += allocation.amount;
                entry.count += 1;

                for (const unlock of allocation?.claimSchedule?.unlocks ?? []) {
                    aggregates.unlocks.push(unlock);

                    if (unlock.claimed) aggregates.claimedTokens += unlock.tokenAmount;
                    else if (unlock.available) aggregates.availableTokens += unlock.tokenAmount;
                    else aggregates.lockedTokens += unlock.tokenAmount;
                }

                return aggregates;
            },
            {
                allocations: new Map<string, { amount: number; count: number; name: string }>(),
                availableTokens: 0,
                claimedTokens: 0,
                creditedTokens: 0,
                lockedTokens: 0,
                unlocks:
                    [] as GetAllocationsQuery['getUserAllocations']['allocations'][number]['claimSchedule']['unlocks'],
            },
        );
        return {
            ...aggregates,
            allocations: Array.from(aggregates.allocations.values()),
            allocationCount: allocationsArray.length,
            isLoading,
            refetch: fetchAllocations,
        };
    }, [allocations]);
}
