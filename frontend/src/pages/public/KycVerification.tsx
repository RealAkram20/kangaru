import { useId } from 'react'
import { ArrowLeft, Check, ChevronRight, Lock, ShieldCheck } from 'lucide-react'
import { kycComplete, type KycDocument, type KycFiles, type KycSection } from './kycDocuments'

/**
 * Identity checks for a self-drive rental.
 *
 * ## What is real and what is not
 *
 * The files never leave the device. The platform has no upload endpoint,
 * no storage disk configured and no document model — `grep` the backend for
 * `UploadedFile` and it returns nothing — so there is nowhere to send them
 * and nobody to review them. What travels with the order is the *list* of
 * documents the renter says they have to hand; the dispatcher checks the
 * originals when the customer collects the vehicle, which is how the keys
 * change hands today anyway.
 *
 * That is also why the reassurance panel below does not promise encryption
 * in transit. It says what actually happens.
 *
 * ## Wiring it to the real thing
 *
 * When document storage lands: POST each file as it is picked, keep the
 * returned id on `KycFile`, and send the ids rather than the names. The
 * screen itself does not change — it already models a document as
 * "chosen or not", which is the same shape as "uploaded or not".
 */

export function KycVerification({
  sections,
  files,
  onFilesChange,
  submitting,
  onSubmit,
  onBack,
}: {
  sections: KycSection[]
  files: KycFiles
  onFilesChange: (files: KycFiles) => void
  submitting: boolean
  onSubmit: () => void
  onBack: () => void
}) {
  return (
    <div className="kr-rise mt-5 lg:mt-8">
      <div className="relative flex items-center justify-center">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="absolute left-0 -m-2 rounded-full p-2 text-brand-green transition-[color,transform] duration-150 ease-[var(--kr-ease-out)] hover:text-brand-green-hover active:scale-95"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </button>
        <h1 className="font-display text-base font-bold text-brand-green">KYC Verification</h1>
      </div>

      <div className="mt-6 flex flex-col items-center text-center">
        <span
          className="grid h-20 w-20 place-items-center rounded-full bg-brand-green-tint"
          aria-hidden
        >
          <ShieldCheck className="h-9 w-9 text-brand-green" />
        </span>
        <h2 className="mt-4 font-display text-2xl font-bold tracking-tight text-text-heading">
          Let&apos;s verify your identity
        </h2>
        <p className="mt-2 max-w-[34ch] text-sm leading-relaxed text-text-secondary">
          This helps us keep the platform safe and secure for everyone.
        </p>
      </div>

      {sections.map((section) => (
        <section key={section.title} className="mt-6">
          <h3 className="text-sm font-semibold text-text-heading">{section.title}</h3>
          <div className="mt-2 overflow-hidden rounded-xl border border-border bg-surface-card">
            {section.documents.map((document, index) => (
              <DocumentRow
                key={document.id}
                document={document}
                fileName={files[document.id]}
                first={index === 0}
                onPick={(name) => onFilesChange({ ...files, [document.id]: name })}
              />
            ))}
          </div>
        </section>
      ))}

      {/* Says what actually happens to the files. See the file header: there
          is nowhere to upload them to yet, and a promise of encryption in
          transit would be a promise about a request nobody makes. */}
      <div className="mt-6 flex gap-3 rounded-xl bg-surface-accent p-4">
        <Lock className="mt-0.5 h-5 w-5 shrink-0 text-brand-green" aria-hidden />
        <div>
          <p className="font-semibold text-brand-green">Your data is secure</p>
          <p className="mt-1 text-sm leading-relaxed text-text-secondary">
            Your documents stay on this device and are only used to verify you. A dispatcher checks
            the originals when you collect the vehicle.
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={onSubmit}
        disabled={!kycComplete(sections, files) || submitting}
        className="mt-6 w-full rounded-xl bg-brand-green px-6 py-4 font-display text-base font-bold text-text-on-brand transition-[background-color,transform,opacity] duration-150 ease-[var(--kr-ease-out)] hover:bg-brand-green-hover active:scale-[0.98] disabled:opacity-50"
      >
        {submitting ? 'Sending…' : 'Submit for Review'}
      </button>
    </div>
  )
}

/**
 * One document. A label wrapping a hidden file input rather than a button:
 * the row opens the picker on a tap anywhere along it, and the input is
 * still the thing keyboard and screen readers land on — which is what
 * announces "National ID, not uploaded" instead of "button".
 */
function DocumentRow({
  document,
  fileName,
  first,
  onPick,
}: {
  document: KycDocument
  fileName: string | undefined
  first: boolean
  onPick: (name: string) => void
}) {
  const id = useId()
  const uploaded = fileName !== undefined

  return (
    <label
      htmlFor={id}
      className={`flex cursor-pointer items-center gap-3 px-4 py-3.5 transition-colors duration-150 hover:bg-surface-sunken focus-within:bg-surface-sunken ${
        first ? '' : 'border-t border-border'
      }`}
    >
      <span className="shrink-0 text-brand-green" aria-hidden>
        {document.icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-text-heading">{document.label}</span>
        {uploaded && <span className="block truncate text-xs text-text-secondary">{fileName}</span>}
      </span>
      <input
        id={id}
        type="file"
        accept="image/*,application/pdf"
        className="sr-only"
        onChange={(e) => {
          const picked = e.target.files?.[0]
          if (picked !== undefined) onPick(picked.name)
        }}
      />
      {uploaded ? (
        <span className="flex shrink-0 items-center gap-1 text-sm font-semibold text-brand-green">
          <Check className="h-4 w-4" strokeWidth={3} aria-hidden />
          Uploaded
        </span>
      ) : (
        <span className="shrink-0 text-sm font-medium text-red-600 dark:text-red-400">
          Not uploaded
        </span>
      )}
      <ChevronRight className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden />
    </label>
  )
}
