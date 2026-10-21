/** QR codes keep the generic UPI URL. Only the payment button targets GPay. */
export function buildGpayLink(upiLink: string, userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent): string {
  if (!upiLink.startsWith('upi://pay?')) throw new Error('Invalid UPI payment link')
  if (/android/i.test(userAgent)) {
    const fallback = encodeURIComponent('https://play.google.com/store/apps/details?id=com.google.android.apps.nbu.paisa.user')
    return `${upiLink.replace('upi://', 'intent://')}#Intent;scheme=upi;package=com.google.android.apps.nbu.paisa.user;S.browser_fallback_url=${fallback};end`
  }
  return upiLink.replace('upi://pay?', 'gpay://upi/pay?')
}
