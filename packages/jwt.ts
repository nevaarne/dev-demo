import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { signLoginPayload } from 'thirdweb/auth';
import { useActiveWallet } from 'thirdweb/react';
import type { Wallet } from 'thirdweb/wallets';

import { LocalStorageKeys, WindowEvents } from '@monorepo/graphql/config';
import captureException from '@monorepo/shared/utils/capture-exception';
import { parseJwt } from '@monorepo/shared/utils/parse-jwt';

export async function getJWT(wallet: Wallet) {
    if (typeof window === 'undefined') {
        console.warn('Cannot login in a non-browser environment.');
        return;
    }

    const account = wallet.getAccount();

    if (!account) throw new Error('Could not fetch account on active wallet.');

    const payloadRes = await fetch(`/api/auth/payload?address=${account.address}&chainId=${1}`);
    const payload = await payloadRes.json();

    const signatureResult = await signLoginPayload({
        account,
        payload,
    });

    const jwtRes = await fetch(`/api/auth/login`, {
        method: 'POST',
        body: JSON.stringify(signatureResult),
    });

    const { token } = await jwtRes.json();

    const signedJwtRes = await fetch(`/api/auth/sign`, {
        method: 'POST',
        body: token,
    });
    const { signature } = await signedJwtRes.json();

    window.localStorage.setItem(LocalStorageKeys.JWT, token);
    window.localStorage.setItem(LocalStorageKeys.SIGNATURE, signature);
}

export function removeJWT() {
    if (typeof window === 'undefined') {
        console.warn('Cannot logout in a non-browser environment.');
        return;
    }

    window.localStorage.removeItem(LocalStorageKeys.JWT);
    window.localStorage.removeItem(LocalStorageKeys.SIGNATURE);
}

let isPending = false;

export function useLogin({ onError }: { onError?: () => void }) {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [isAuthenticating, setIsAuthenticating] = useState(false);

    const wallet = useActiveWallet();
    const router = useRouter();

    const login = useCallback<typeof getJWT>(async (wallet) => {
        if (isPending) return;
        isPending = true;
        await getJWT(wallet);
        isPending = false;
        setIsAuthenticated(true);
    }, []);

    const logout = useCallback<typeof removeJWT>(() => {
        setIsAuthenticated(false);
        removeJWT();
    }, []);

    const refreshLogin = useCallback(async () => {
        if (!wallet) return;
        if (isPending) return;
        setIsAuthenticating(true);
        try {
            await login(wallet);
        } catch (error) {
            onError?.();
            captureException(error, { id: 'auto_login' });
            logout();
        } finally {
            setIsAuthenticating(false);
        }
    }, [login, logout, onError, wallet]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (!wallet) return;
        if (isPending) return;

        const url = new URL(window.location.href);

        let jwt = url.searchParams.get(LocalStorageKeys.JWT);
        let jwtSignature = url.searchParams.get(LocalStorageKeys.SIGNATURE);

        if (jwt && jwtSignature) {
            window.localStorage.setItem(LocalStorageKeys.JWT, jwt);
            window.localStorage.setItem(LocalStorageKeys.SIGNATURE, jwtSignature);
            url.searchParams.delete(LocalStorageKeys.JWT);
            url.searchParams.delete(LocalStorageKeys.SIGNATURE);
            router.replace(url.toString());
        } else {
            jwt = window.localStorage.getItem(LocalStorageKeys.JWT);
            jwtSignature = window.localStorage.getItem(LocalStorageKeys.SIGNATURE);
        }

        const jwtExpired = jwt && jwtSignature ? Date.now() >= parseJwt(jwt).exp * 1000 : true;
        
        if (!jwtExpired) {
            setIsAuthenticated(true);
            return;
        } else {
            refreshLogin();
        }
    }, [refreshLogin, isAuthenticated, router, wallet]);

    useEffect(() => {
        if (typeof window === 'undefined') return;

        async function refresh() {
            window.removeEventListener(WindowEvents.REFRESH_LOGIN, refresh);
            await refreshLogin();
            window.dispatchEvent(new CustomEvent(WindowEvents.REFRESHED_LOGIN));
        }

        window.addEventListener(WindowEvents.REFRESH_LOGIN, refresh);

        return () => window.removeEventListener(WindowEvents.REFRESH_LOGIN, refresh);
    }, [refreshLogin]);

    return useMemo(
        () => ({
            isAuthenticated,
            isAuthenticating,
            login,
            logout,
        }),
        [isAuthenticated, isAuthenticating, login, logout],
    );
}
