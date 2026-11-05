import { pb } from '../client';
import { browser } from '$app/environment';
import { GlobalRole } from '$lib/types/roles';
import { notificationStore } from './notifications.svelte';
import { ClientResponseError, getTokenPayload, type RecordModel } from 'pocketbase';
import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import toast from 'svelte-french-toast';

interface User {
	id: string;
	email: string;
	username?: string;
	verified: boolean;
	nickname?: string;
	avatar?: string;
	profilePicture?: string;
	orcid?: string;
	orcidVerifiedAt?: string;
	affiliation?: string;
	titleRole?: string;
	bio?: string;
	socials?: string;
	role?: GlobalRole;
	created: string;
	updated: string;
}

class AuthStore {
	user = $state<User | null>(null);
	sessionLocked = $state(false);
	private sessionCheck: Promise<RecordModel> | null = null;
	isAuthenticated = $derived(!!this.user);
	appUserId = $derived(this.user?.id ?? null);
	globalRole = $derived<GlobalRole>(this.user?.role ?? GlobalRole.User);

	constructor() {
		if (browser) {
			pb.beforeSend = (url, options) => {
				if (pb.authStore.token && !pb.authStore.isValid) {
					this.expireSession();
					throw new Error('Your session has expired. Please sign in with ORCID again.');
				}
				return { url, options };
			};
			pb.afterSend = async (response, data, options) => {
				const token = pb.authStore.token;
				const requestToken = new Headers(options?.headers).get('Authorization');
				// Ignore anonymous requests and responses belonging to an older login.
				if (token && requestToken === token) {
					if (response.status === 401) this.expireSession();
					// PocketBase also masks failed update permissions as 404. Check the
					// session before treating that response as a missing record.
					if (response.status === 404 && !response.url.endsWith('/auth-refresh')) {
						try {
							await this.refreshSession();
						} catch {
							// Network failures must not sign out a valid session.
						}
					}
					if (this.sessionLocked)
						throw new Error('Your session has expired. Please sign in with ORCID again.');
				}
				return data;
			};
			if (!pb.authStore.isValid) pb.authStore.clear();
			this.user = pb.authStore.record as User | null;

			pb.authStore.onChange(() => {
				this.user = pb.authStore.isValid ? (pb.authStore.record as User | null) : null;
				if (this.user) {
					notificationStore.subscribe(this.user.id);
				} else {
					notificationStore.unsubscribeAll();
				}
			});

			if (this.user) {
				notificationStore.subscribe(this.user.id);
			}
		}
	}

	expireSession() {
		if (this.sessionLocked) return;
		this.sessionLocked = true;
		this.logout();
		toast.error('Your session has expired. Please sign in with ORCID again.');
		void goto(resolve('/'), { replaceState: true })
			.then(() => {
				this.sessionLocked = false;
			})
			.catch(() => {
				// Keep the current screen locked if navigation fails.
			});
	}

	watchSession() {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const check = () => {
			clearTimeout(timer);
			if (!pb.authStore.token) return;
			if (!pb.authStore.isValid) {
				this.expireSession();
				return;
			}
			const expiresAt = Number(getTokenPayload(pb.authStore.token).exp) * 1000;
			timer = setTimeout(check, Math.min(Math.max(expiresAt - Date.now(), 1), 2_147_483_647));
		};
		const verify = () => {
			check();
			if (pb.authStore.isValid) void this.refreshSession().catch(() => {});
		};
		const visible = () => {
			if (document.visibilityState === 'visible') verify();
		};
		const unsubscribe = pb.authStore.onChange(check);
		window.addEventListener('focus', verify);
		document.addEventListener('visibilitychange', visible);
		verify();
		return () => {
			clearTimeout(timer);
			unsubscribe();
			window.removeEventListener('focus', verify);
			document.removeEventListener('visibilitychange', visible);
		};
	}

	async refreshSession() {
		if (!pb.authStore.isValid) {
			this.expireSession();
			throw new Error('Your session has expired. Please sign in with ORCID again.');
		}
		if (this.sessionCheck) return this.sessionCheck;
		const token = pb.authStore.token;
		this.sessionCheck = this.performSessionRefresh(token);
		try {
			return await this.sessionCheck;
		} finally {
			this.sessionCheck = null;
		}
	}

	private async performSessionRefresh(token: string) {
		try {
			const result = await pb.send<{ token: string; record: RecordModel }>(
				'/api/collections/users/auth-refresh',
				{ method: 'POST' }
			);
			// A pending refresh must never restore an account after logout or an account switch.
			if (pb.authStore.token === token) pb.authStore.save(result.token, result.record);
			return result.record;
		} catch (error) {
			if (
				pb.authStore.token === token &&
				error instanceof ClientResponseError &&
				[401, 403].includes(error.status)
			) {
				this.expireSession();
				throw new Error('Your session is no longer valid. Please sign in with ORCID again.');
			}
			throw error;
		}
	}

	async loginWithOrcid() {
		const authData = await pb.collection('users').authWithOAuth2({
			provider: 'oidc',
			scopes: ['openid']
		});
		if (!authData.record.orcid || !authData.record.orcidVerifiedAt) {
			this.logout();
			throw new Error('ORCID verification was not completed. Please contact an administrator.');
		}
		this.user = authData.record as unknown as User;
		try {
			await pb.send('/api/pure3d/orcid/profile-refresh', { method: 'POST' });
			const record = await pb.collection('users').getOne(authData.record.id);
			pb.authStore.save(pb.authStore.token, record);
		} catch {
			// A public-profile outage must not undo a verified sign-in; users can retry in Profile.
		}
		return authData;
	}

	async loginWithPassword(email: string, password: string) {
		return await pb.collection('users').authWithPassword(email, password);
	}

	logout() {
		pb.authStore.clear();
		this.user = null;
		notificationStore.unsubscribeAll();
	}
}

export const authStore = new AuthStore();
