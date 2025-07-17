import { type DocumentNode, useMutation, useQuery } from '@apollo/client';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { getFragment, gql } from '../graphql/generated';
import type { AccountQuery, MutationResult } from '../graphql/generated/graphql';

export const TWITTER_FRAGMENT = gql(`
  fragment TwitterData on GameUser {
    twitter {
      handle
      profileImageUrl
    }
  }
`);

const CONNECT_TWITTER_TO_GAME_USER = gql(`
  query ConnectTwitterToGameUser($callbackUrl: String!) {
      getTwitterRequestToken(callbackUrl: $callbackUrl) {
          oauthToken
          oauthTokenSecret
          oauthCallbackConfirmed
      }
  }
`);

const SET_TWITTER_ACCESS_TOKEN = gql(`
  mutation SetTwitterAccessToken($oauthToken: String!, $oauthVerifier: String!) {
      setTwitterAccessToken(oauthToken: $oauthToken, oauthVerifier: $oauthVerifier) {
          success
          message
      }
  }
`);

const DISCONNECT_TWITTER_FROM_GAME_USER = gql(`
  mutation DisconnectTwitterFromGameUser{
      disconnectFromTwitter {
          success
          message
      }
  }
`);

export function useTwitter({ data, query }: { data?: AccountQuery; query: DocumentNode }) {
    const gameUser = getFragment(TWITTER_FRAGMENT, data?.getGameUser);
    const { refetch: connect, loading: connectingTwitter } = useQuery(
        CONNECT_TWITTER_TO_GAME_USER,
        {
            fetchPolicy: 'no-cache',
            skip: true,
            variables: {
                // TODO: add staking website to whitelist
                callbackUrl: typeof window !== 'undefined' ? window.location.href : '',
            },
        },
    );

    const [disconnect, { loading: isTwitterDisconnecting }] = useMutation(
        DISCONNECT_TWITTER_FROM_GAME_USER,
        { awaitRefetchQueries: true, refetchQueries: [query] },
    );

    const [setAccessToken, { loading: settingAccessToken }] = useMutation(
        SET_TWITTER_ACCESS_TOKEN,
        { awaitRefetchQueries: true, refetchQueries: [query] },
    );

    const [ twitterConnectRes, setTwitterConnectRes ] = useState<MutationResult>({ success: false, message: '' });

    const isTwitterConnecting = connectingTwitter || settingAccessToken;

    const router = useRouter();

    const connectTwitter = useCallback(async () => {
        if (typeof window === 'undefined') return;
        if (!gameUser) return;

        let data = undefined;
        try {
            data = (await connect()).data;
        } catch (e) {
            console.log(e);
        }

        if (!data?.getTwitterRequestToken?.oauthCallbackConfirmed) {
            setTwitterConnectRes({ success: false, message: 'X connection refused.' });
            return;
        }
        window.location.href = `https://api.twitter.com/oauth/authorize?oauth_token=${data.getTwitterRequestToken.oauthToken}`;
    }, [connect, gameUser]);

    /** Automatically resets state */
    useEffect(() => {
        const { success, message } = twitterConnectRes;
        if(!success && !message) return;
        setTwitterConnectRes({ success: false, message: '' });
    }, [twitterConnectRes]);

    const disconnectTwitter = useCallback(async () => {
        const { data } = await disconnect();

        if (!data?.disconnectFromTwitter?.success) {
            throw new Error(data?.disconnectFromTwitter?.message ?? 'Operation error.');
        }
    }, [disconnect]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (!gameUser || gameUser.twitter.handle || isTwitterConnecting) return;

        const url = new URL(window.location.href);
        const oauthToken = url.searchParams.get('oauth_token');
        const oauthVerifier = url.searchParams.get('oauth_verifier');

        if (!oauthToken || !oauthVerifier) return;

        url.searchParams.delete('oauth_token');
        url.searchParams.delete('oauth_verifier');
        router.replace(url.toString());

        (async () => {
            const { data } = await setAccessToken({
                variables: { oauthToken, oauthVerifier },
            });

            if (!data?.setTwitterAccessToken?.success) {
                const message = data?.setTwitterAccessToken?.message ?? 'X connection failed.';
                setTwitterConnectRes({ success: false, message });
                throw new Error(message);
            }

            setTwitterConnectRes({ success: true, message: 'X connection successful!' });
        })();
    }, [gameUser, router, setAccessToken, isTwitterConnecting]);

    return useMemo(
        () => ({
            connectTwitter,
            isTwitterConnecting,
            twitterConnectRes,
            disconnectTwitter,
            isTwitterDisconnecting,
        }),
        [connectTwitter, disconnectTwitter, isTwitterConnecting, isTwitterDisconnecting, twitterConnectRes],
    );
}
