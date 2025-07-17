/* eslint react-hooks/exhaustive-deps: error */
import { useVirtualizer } from '@tanstack/react-virtual';
import React, { useCallback, useContext, useMemo, useRef, useState } from 'react';

import { useAccount } from '../packages/account';
import captureException from '@monorepo/shared/utils/capture-exception';

import { useAllocations } from '../hooks/allocations';
import { useClaims } from '../hooks/claiming';
import { GetAllocationsQuery } from '@/graphql/generated/graphql';

import { AppContext } from '../../context/app-context';
import { formatNumber } from '../../utils/format-number';
import Button from '../button';
import useClaimSubmitDialog from '../hooks/use-claim-submit-dialog';
import useSessionRedirect from '../hooks/use-session-redirect';
import Loader from '../loader';
import { NumberDisplay } from '../number-display';
import PageTitle from '../page-title';
import BoostItem from '../staking-page/boost-item';
import TextWithHint from '../text-with-hint';
import { ActivityItem } from './activity-item';
import ClaimPageChart from './chart';
import css from './claim-page.module.css';

const getPercentage = (total: number, num: number) => ((num / total) * 100).toFixed(2);

const ClaimPageView: React.FC = () => {
    const { connect, isAuthenticated } = useAccount();
    const { showAlert } = useContext(AppContext);
    
    const {
        aggregates,
        lastClaimPending,
        claimAllocation,
        claimStakingRewards,
        claimAllocationMutationData: { loading: claimingAllocation },
        claimStakingRewardsMutationData: { loading: claimingStakingRewards },
        claimsQuery,
    } = useClaims();

    const {
        allocations,
        allocationCount,
        creditedTokens,
        claimedTokens,
        availableTokens,
        lockedTokens,
        isLoading: isLoadingAllocations,
        unlocks: unlocksData,
        refetch: fetchAllocations,
    } = useAllocations();

    useSessionRedirect();

    const fmtNumber = formatNumber('.0');
    const [tabIndex, setTabIndex] = useState<number>(0);

    const [activeColumn, setActiveColumn] = useState<'tokenCrediting' | 'unlocksAnalytics'>(
        'tokenCrediting',
    );

    const pageIsLoading = useMemo(() => !claimsQuery.data && claimsQuery.loading, [claimsQuery]);
    const { Dialog, onClaimSubmitted } = useClaimSubmitDialog();

    const unlocks = useMemo(
        () =>
            unlocksData.sort(
                (a, b) => Number(new Date(a.unlockTimestamp)) - Number(new Date(b.unlockTimestamp)),
            ),
        [unlocksData],
    );
    const unclaimedUnlocks = useMemo(() => unlocks.filter((unlock) => !unlock.claimed), [unlocks]);
    const claimedUnlocks = useMemo(() => unlocks.filter((unlock) => unlock.claimed), [unlocks]);

    const { totalInCharts } = useMemo(
        () => ({
            claimedAll: availableTokens === 0 && lockedTokens === 0 && claimedTokens > 0,
            totalInCharts: claimedTokens + availableTokens + lockedTokens,
        }),
        [availableTokens, claimedTokens, lockedTokens],
    );

    const onClaim = useCallback(async () => {
        if(!claimsQuery.data?.getGameUser.dailyInfo.canClaimTokens) {
            showAlert("You may only claim once per hour.", 'fail');
            return;
        }

        let successMessage = "";
        let errorMessage = "";
        let submittedClaimsRes = undefined;

        if (availableTokens) {
            const [error, message] = await claimAllocation();

            if (error) {
                captureException(error, { id: '_token_claim' });
                errorMessage += ("Allocations claim error. " + error?.message + " ");
            } else {
                submittedClaimsRes = message;
                successMessage += "Allocations claim successful. ";
                fetchAllocations();
            }
        }

        if (aggregates.accruedStakeTokens + aggregates.accruedStakeTokens) {
            const [error] = await claimStakingRewards();

            if (error) {
                captureException(error, { id: 'staking_rewards_claim' });
                errorMessage += ("Staking rewards claim error. " + error?.message + " ");
            } else {
                successMessage += "Staking rewards claim successful. ";
            }
        } else {
            claimsQuery.refetch();
        }

        if (errorMessage) {
            showAlert(successMessage + errorMessage, 'fail');
            return;
        }

        onClaimSubmitted(submittedClaimsRes);
    }, [
        claimsQuery,
        availableTokens, 
        aggregates.accruedStakeTokens,
        aggregates.accruedStakeTokens,
        claimAllocation, 
        claimStakingRewards,
        fetchAllocations, 
        onClaimSubmitted, 
        showAlert
    ]);

    return (
        <>
            <Dialog />

            <div
                className={`${css.root} ${
                    !isAuthenticated || creditedTokens === 0 ? css.noToken : ''
                }`}>
                <div className={css.fixedBg} />
                <PageTitle title="$ TOKEN" subTitle="The gateway to sports culture" />
                {pageIsLoading && <Loader />}
                {!pageIsLoading && (
                    <>
                        <div className={css.head}>
                            <div className={css.headColumn}>
                                <div className={css.headColumnTitle}>Total Unlocked Airdrop</div>
                                <div className={css.tokenValue}>
                                    <img src="/images/coin.png" alt="" />
                                    {!isAuthenticated && <>-</>}
                                    {isAuthenticated &&
                                        (creditedTokens > 0 ? (
                                            fmtNumber(creditedTokens)
                                        ) : (
                                            <>0</>
                                        ))}
                                </div>
                                <div className={css.note}>
                                    {!isAuthenticated && (
                                        <>
                                            You will see the amount of credited $ as soon as you
                                            connect your wallet.
                                        </>
                                    )}

                                    {isAuthenticated && creditedTokens === 0 && (
                                        <TextWithHint hint="We credit Tokens for your allocations or $ Points. If these are linked to a different wallet, please connect it. For more details, visit the About and FAQ pages.">
                                            No Tokens credited.
                                        </TextWithHint>
                                    )}
                                </div>
                            </div>
                            <div className={css.headColumn}>
                                {isAuthenticated && (
                                    <>
                                        <div className={css.innerColumn}>
                                            <div className={css.headColumnTitle}>
                                                Tokens available to claim
                                            </div>
                                            <div className={css.tokenValue}>
                                                <img src="/images/coin.png" alt="" />
                                                {fmtNumber(
                                                    availableTokens + 
                                                    aggregates.accruedStakeTokens + 
                                                    aggregates.accruedStakeTokens
                                                )}
                                            </div>
                                            <Button
                                                onClick={onClaim}
                                                loading={claimingAllocation || claimingStakingRewards}
                                                disabled={
                                                    (
                                                        lastClaimPending &&
                                                        !claimingAllocation &&
                                                        !claimingStakingRewards
                                                    ) || (
                                                        availableTokens + 
                                                        aggregates.accruedStakeTokens +
                                                        aggregates.accruedStakeTokens
                                                    ) === 0
                                                }>
                                                Claim
                                            </Button>
                                            {lastClaimPending &&
                                                !claimingAllocation &&
                                                !claimingStakingRewards && (
                                                    <div
                                                        className={css.note}
                                                        style={{ marginTop: 12 }}>
                                                        Claim processing...
                                                    </div>
                                                )}
                                        </div>
                                        <div className={css.devider}></div>
                                        <div className={css.innerColumn}>
                                            <div className={css.innerColumnRow}>
                                                <div className={css.headColRowLabel}>
                                                    Allocation Tokens:
                                                </div>
                                                <div className={css.headColRowValue}>
                                                    <img src="/images/coin.png" alt="" />
                                                    <NumberDisplay
                                                        value={availableTokens}
                                                    />
                                                </div>
                                            </div>
                                            <div className={css.innerColumnRow}>
                                                <div className={css.headColRowLabel}>
                                                    <TextWithHint hint={`Staking rewards will be paid out at the end of the week.\nPending payout: ${Math.floor(aggregates.pendingClaimedTokens)} $`}>
                                                        Staking Rewards:
                                                    </TextWithHint>                                                    
                                                </div>
                                                <div className={css.headColRowValue}>
                                                    <img src="/images/coin.png" alt="" />
                                                    <NumberDisplay
                                                        value={
                                                            aggregates.accruedStakeTokens + 
                                                            aggregates.accruedStakeTokens
                                                        }
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </>
                                )}

                                {!isAuthenticated && (
                                    <>
                                        <div className={css.headColumnTitle}>
                                            Connect your wallet to claim your Tokens
                                        </div>
                                        <Button onClick={() => connect()}>Connect Wallet</Button>
                                    </>
                                )}
                            </div>
                        </div>
                        <div className={css.bodyTabs}>
                            <div
                                onClick={setActiveColumn.bind(null, 'tokenCrediting')}
                                className={`${css.bodyTab} ${
                                    activeColumn === 'tokenCrediting' ? css.active : ''
                                }`}>
                                Your Token Allocation
                            </div>
                            <div
                                onClick={setActiveColumn.bind(null, 'unlocksAnalytics')}
                                className={`${css.bodyTab} ${
                                    activeColumn === 'unlocksAnalytics' ? css.active : ''
                                }`}>
                                Your Overview
                            </div>
                        </div>
                        <div className={`${css.body} ${css[activeColumn]}`}>
                            <div className={`${css.bodyColumn} ${css.tokenCrediting}`}>
                                <div className={css.bodyColumnTitle}>Your Overview</div>
                                <div className={css.column}>
                                    <div className={css.columnTitle}>
                                        Allocations&nbsp;
                                        {allocationCount} / {aggregates.numAllocations}
                                    </div>
                                    <div className={`${css.window} ${css.boostWindow}`}>
                                        {isLoadingAllocations && (
                                            <div className="m-4 mb-2 flex flex-col items-center gap-2 rounded-md border border-warningFg bg-warningBg p-6">
                                                <div className="relative size-16 [&_svg]:fill-white">
                                                    <Loader />
                                                </div>
                                                <p>Loading allocations. Please stand by.</p>
                                            </div>
                                        )}
                                        {!isLoadingAllocations && allocations.length === 0 && (
                                            <div className={css.windowContentEmpty}>
                                                <img
                                                    className={css.windowContentEmptyImg}
                                                    src="/images/no-data.png"
                                                    alt=""
                                                />
                                                No allocations
                                            </div>
                                        )}
                                        {allocations.length !== 0 && (
                                            <div className={css.windowContent}>
                                                {allocations.map((item) => (
                                                    <BoostItem
                                                        key={item.name}
                                                        name={item.name}
                                                        count={item.count}
                                                        value={item.amount}
                                                    />
                                                ))}
                                            </div>
                                        )}
                                        <div className={css.windowFooter}>
                                            <div className={css.windowFooterTitle}>
                                                Total $ Tokens:
                                            </div>
                                            <div className={css.windowFooterValue}>
                                                <img src="/images/coin.png" alt="" />
                                                <NumberDisplay value={creditedTokens} />
                                            </div>
                                        </div>
                                    </div>
                                    {/* <div className={css.columnTitle}>
                                        Converted from $ Points
                                    </div>
                                    <div className={`${css.window} ${css.pointsWindow}`}>
                                        <div className={css.PointsRow}>
                                            <div className={css.PointsTitle}>$ Tokens:</div>
                                            <div
                                                className={`${css.windowFooterValue} ${css.PointsValue}`}>
                                                <img src="/images/coin.png" alt="" />
                                                <NumberDisplay value={totalTokens} />
                                            </div>
                                        </div>
                                    </div> */}
                                </div>
                            </div>
                            <div className={`${css.bodyColumn} ${css.unlocksAnalytics}`}>
                                <div className={css.bodyColumnTitle}>Unlocks Analytics</div>
                                <div className={`${css.column}`}>
                                    <div className={css.chart}>
                                        {!claimedTokens &&
                                        !availableTokens &&
                                        !lockedTokens ? (
                                            <img src="/images/chart-placeholder.svg" alt="" />
                                        ) : (
                                            <ClaimPageChart
                                                claimed={claimedTokens}
                                                available={availableTokens}
                                                locked={lockedTokens}
                                                activeColumn={activeColumn}
                                            />
                                        )}
                                        <div
                                            className={`${css.chartlegend} ${
                                                !claimedTokens &&
                                                !availableTokens &&
                                                !lockedTokens
                                                    ? css.noData
                                                    : ''
                                            }`}>
                                            <div className={css.chartPlaceholderNumbers}>
                                                <div>
                                                    <span className={`${css.claimed}`} />
                                                    Claimed
                                                    {!!totalInCharts && (
                                                        <div className={css.percent}>
                                                            {getPercentage(
                                                                totalInCharts,
                                                                claimedTokens,
                                                            )}
                                                            %
                                                        </div>
                                                    )}
                                                </div>
                                                <div>
                                                    <span className={`${css.available}`} />
                                                    Available
                                                    {!!totalInCharts && (
                                                        <div className={css.percent}>
                                                            {getPercentage(
                                                                totalInCharts,
                                                                availableTokens,
                                                            )}
                                                            %
                                                        </div>
                                                    )}
                                                </div>
                                                <div>
                                                    <span className={`${css.locked}`} />
                                                    Locked
                                                    {!!totalInCharts && (
                                                        <div className={css.percent}>
                                                            {getPercentage(
                                                                totalInCharts,
                                                                lockedTokens,
                                                            )}
                                                            %
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                            <div className={css.chartNumbers}>
                                                <div className={css.chartNumber}>
                                                    <img src="/images/coin.png" alt="" />
                                                    <NumberDisplay value={claimedTokens} />
                                                </div>
                                                <div className={css.chartNumber}>
                                                    <img src="/images/coin.png" alt="" />
                                                    <NumberDisplay value={availableTokens} />
                                                </div>
                                                <div className={css.chartNumber}>
                                                    <img src="/images/coin.png" alt="" />
                                                    <NumberDisplay value={lockedTokens} />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <div className={css.tabsContainer}>
                                        <div className={css.tabs}>
                                            <div
                                                onClick={setTabIndex.bind(null, 0)}
                                                className={`${css.tab} ${
                                                    tabIndex === 0 ? css.active : ''
                                                }`}>
                                                Unclaimed
                                            </div>
                                            <div
                                                onClick={setTabIndex.bind(null, 1)}
                                                className={`${css.tab} ${
                                                    tabIndex === 1 ? css.active : ''
                                                }`}>
                                                Claimed
                                            </div>
                                        </div>
                                        <div className={css.tabContent}>
                                            {tabIndex === 0 && (
                                                <ScrollPanel data={unclaimedUnlocks} />
                                            )}
                                            {tabIndex === 1 && (
                                                <ScrollPanel data={claimedUnlocks} />
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </>
    );
};

const ScrollPanel = ({
    data,
}: {
    data: GetAllocationsQuery['getUserAllocations']['allocations'][number]['claimSchedule']['unlocks'];
}) => {
    const parentRef = useRef(null);

    const rowVirtualizer = useVirtualizer({
        count: data.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => 72,
        overscan: 5,
    });

    if (data.length === 0) {
        return (
            <div className={css.scrollPanel}>
                <div className={css.scrollPanelEmpty}>
                    <img className={css.windowContentEmptyImg} src="/images/no-data.png" alt="" />
                    <div className={css.scrollPanelEmptyText}>No unclaimed Unlocks</div>
                </div>
            </div>
        );
    }

    return (
        <div ref={parentRef} className={css.scrollPanel}>
            {rowVirtualizer.getVirtualItems().map((virtualRow) => (
                <div
                    key={virtualRow.index}
                    className={virtualRow.index % 2 ? 'ListItemOdd' : 'ListItemEven'}
                    style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: `${virtualRow.size}px`,
                        transform: `translateY(${virtualRow.start}px)`,
                    }}>
                    <ActivityItem item={data[virtualRow.index]} />
                </div>
            ))}
        </div>
    );
};

export default ClaimPageView;
