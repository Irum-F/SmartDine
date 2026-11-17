'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { io } from 'socket.io-client';
import { api, ApiError } from './api.js';

export const ROLE_HOME = { owner: '/staff/floor', manager: '/staff/floor', waiter: '/staff/floor', kitchen: '/staff/kitchen' };

export const errorText = (err) => {
  if (!(err instanceof ApiError)) return 'Connection problem. Please try again.';
  const issue = Array.isArray(err.details) ? err.details[0] : null;
  return issue?.message ? issue.message : err.message;
};
const isAuthError = (err) => err instanceof ApiError && (err.status === 401 || err.status === 403);

// Loads the signed-in staff member, and sends them elsewhere if they can't use this screen
export function useStaff(allowedRoles) {
  const router = useRouter();
  const [me, setMe] = useState(null);
  const roles = allowedRoles?.join(',');

  useEffect(() => {
    let stopped = false;
    let timer;
    const loadMe = async () => {
      try {
        const data = await api('/staff/me');
        if (stopped) return;
        if (data.mustChangePin) return router.replace('/staff/change-pin');
        if (roles && !roles.split(',').includes(data.role)) return router.replace(ROLE_HOME[data.role] ?? '/staff/login');
        setMe(data);
      } catch (err) {
        if (stopped) return;
        if (isAuthError(err)) router.replace('/staff/login');
        else timer = setTimeout(loadMe, 3000); // shaky Wi-Fi: keep trying instead of signing the kitchen out
      }
    };
    loadMe();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [router, roles]);

  return [me, setMe];
}

// API calls from staff screens: an expired login goes straight back to the sign-in page
export function useStaffApi() {
  const router = useRouter();
  return useCallback(
    async (path, options) => {
      try {
        return await api(path, options);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) router.replace('/staff/login');
        throw err;
      }
    },
    [router]
  );
}

// Live connection: loads a snapshot on every (re)connect, applies events, and re-syncs every 30 seconds
export function useLiveSocket({ enabled, onSync, handlers }) {
  const router = useRouter();
  const [status, setStatus] = useState('connecting');
  const latest = useRef({ onSync, handlers });
  latest.current = { onSync, handlers };

  useEffect(() => {
    if (!enabled) return;
    const url = process.env.NEXT_PUBLIC_SOCKET_URL; // only set for local development
    const socket = io(url, url ? { transports: ['websocket'] } : {});
    let retry;
    const reconnectSoon = () => {
      retry = setTimeout(() => socket.connect(), 1000 + Math.random() * 2000);
    };

    socket.on('connect', () => {
      setStatus('live');
      latest.current.onSync();
    });
    socket.on('disconnect', async (reason) => {
      setStatus('reconnecting');
      // Deploy, logout, PIN change or expired login: the server ended the connection on purpose,
      // and Socket.IO won't reconnect by itself. Check the login, then reconnect (fix 1).
      if (reason !== 'io server disconnect') return;
      try {
        await api('/staff/me');
        reconnectSoon();
      } catch (err) {
        if (isAuthError(err)) router.replace('/staff/login');
        else reconnectSoon();
      }
    });
    socket.on('connect_error', (err) => {
      setStatus('reconnecting');
      if (err.message === 'UNAUTHORIZED') router.replace('/staff/login');
    });
    for (const event of Object.keys(latest.current.handlers)) {
      socket.on(event, (payload) => latest.current.handlers[event]?.(payload));
    }

    latest.current.onSync(); // show data straight away, even before the live connection is up
    const poll = setInterval(() => latest.current.onSync(), 30_000);
    return () => {
      clearInterval(poll);
      clearTimeout(retry);
      socket.disconnect();
    };
  }, [enabled, router]);

  return status;
}

// Browsers only allow sound after someone taps the page, so this runs from a button
export function createAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx();
  ctx.resume();
  return ctx;
}

// A two-note chime generated in the browser, with no audio file to load
export function chime(ctx) {
  if (!ctx) return;
  const t = ctx.currentTime;
  [880, 1318.5].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const start = t + i * 0.18;
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.35, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.5);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.55);
  });
}

// Keeps a kitchen tablet's screen on. Browsers release the lock when the tab is hidden, so re-take it.
export function useWakeLock(active) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock;
    let stopped = false;
    const acquire = async () => {
      try {
        lock = await navigator.wakeLock.request('screen');
      } catch {
        // battery saver or unsupported: the screen just follows its normal timeout
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !stopped) acquire();
    };
    acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisible);
      lock?.release().catch(() => {});
    };
  }, [active]);
}