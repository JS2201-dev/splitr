import { useEffect, useState } from 'react'
import type { PlanBundle } from '@/domain/types'
import { formatMinor } from '@/domain/money'
import { buildShareText, buildUpiTargets, buildUpiQr, shareText, whatsappShareUrl, type UpiTarget } from '@/export/share'
import { useUiStore } from '@/store/useUiStore'
import { Sheet } from './ui'

export function ShareSheet({ open, onClose, bundle }: { open: boolean; onClose: () => void; bundle: PlanBundle }) {
  const text = buildShareText(bundle)
  const toast = useUiStore((s) => s.showToast)
  return <Sheet open={open} onClose={onClose} title="Share settlement" subtitle="Summary and per-person payment QR codes">
    <div className="space-y-4">
      <div className="flex gap-2"><button className="btn-primary flex-1" onClick={async () => {
        const result = await shareText(bundle.plan.name, text)
        toast(result === 'shared' ? 'Shared' : result === 'copied' ? 'Summary copied' : 'Could not share')
      }}>Share summary</button><a className="btn-secondary" href={whatsappShareUrl(text)} target="_blank" rel="noreferrer">WhatsApp</a></div>
      {open && buildUpiTargets(bundle).map((target) => <PaymentQr key={`${target.fromPersonId}-${target.toPersonId}`} target={target} bundle={bundle} />)}
      <p className="text-xs text-ink-500">QR codes open any compatible UPI app. Payment status still needs confirmation.</p>
    </div>
  </Sheet>
}

function PaymentQr({ target, bundle }: { target: UpiTarget; bundle: PlanBundle }) {
  const [qr, setQr] = useState('')
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  const toast = useUiStore((s) => s.showToast)
  const from = bundle.people.find((p) => p.id === target.fromPersonId)?.name ?? '?'
  useEffect(() => {
    let active = true
    setQr(''); setError(false)
    buildUpiQr(target.link).then((url) => { if (active) setQr(url) }).catch(() => { if (active) setError(true) })
    return () => { active = false }
  }, [target.link])
  const text = `${bundle.plan.name}: ${from} pays ${target.toName} ${formatMinor(target.amountMinor, bundle.plan.currency)}. ${target.link}`
  async function shareQr() {
    if (!qr) return
    setBusy(true)
    try {
      const bytes = Uint8Array.from(atob(qr.split(',')[1]), (c) => c.charCodeAt(0))
      const file = new File([bytes], 'splitr-payment-qr.png', { type: 'image/png' })
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: bundle.plan.name, text })
      else {
        const result = await shareText(bundle.plan.name, text)
        toast(result === 'copied' ? 'Payment details copied; download the QR to attach it' : result === 'failed' ? 'Could not share' : 'Shared')
      }
    } catch (error) { if ((error as Error).name !== 'AbortError') toast('Could not share the QR. Try downloading it.') }
    finally { setBusy(false) }
  }
  return <div className="rounded-xl border border-ink-200 p-4 text-center dark:border-ink-800">
    <p className="font-semibold">{from} → {target.toName}</p><p>{formatMinor(target.amountMinor, bundle.plan.currency)}</p>
    <p className="break-all text-xs text-ink-500">{target.toUpiId}</p>
    {qr ? <img className="mx-auto my-3 size-48 rounded-lg" src={qr} alt={`QR for ${from} to pay ${target.toName}`} /> : <p className="my-3 text-sm" role="status">{error ? 'Could not generate QR' : 'Generating QR…'}</p>}
    {qr && <div className="flex justify-center gap-2"><button className="btn-secondary" disabled={busy} onClick={shareQr}>Share QR</button><a className="btn-secondary" href={qr} download="splitr-payment-qr.png">Download QR</a></div>}
    <a className="mt-3 inline-block text-sm text-blue-600" href={target.link}>Pay with any UPI app</a>
  </div>
}
