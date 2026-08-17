/**
 * THE QUIZ — the only React island in the template.
 *
 * The important thing about this file is what it does NOT contain: a list of
 * categories. Reference implementations of this pattern hardcode
 *
 *     ['Hot Tub', 'Swim Spa', 'Sauna', 'Massage Chair', 'Just Browsing']
 *
 * straight into the component. That is the saunas defect wearing a different
 * hat — a client who does not sell saunas gets asked whether they want one,
 * and then has a sauna lead in their CRM. Here the options arrive as a prop
 * built from the enabled-categories array, the same one the nav, the routes,
 * the sitemap and the database queries read.
 *
 * Every PII input carries the correct `autocomplete` token. On the old site
 * the contact form had none, which broke autofill for Facebook mobile
 * traffic — the majority of it — and cost completions on the single form
 * that mattered.
 */

import { useState, type FormEvent } from 'react';
import { useStore } from '@nanostores/react';
import { quizStore, selectCategory, resetQuiz } from '../../stores/quiz';
import { CONSENT_VERSION, consentTextFor } from '../../config/consent';

export interface QuizOption {
  slug: string;
  label: string;
}

interface Props {
  /** Built from config. The component never invents an option. */
  options: QuizOption[];
  businessName: string;
  phoneDisplay: string;
  telHref: string;
  /** Where the lead came from, for the CRM. */
  sourcePage: string;
  /** Pre-selected product, when the quiz sits on a product page. */
  productSlug?: string;
  heading?: string;
  variant?: 'primary' | 'secondary';
}

interface FormState {
  name: string;
  email: string;
  phone: string;
  message: string;
}

const EMPTY: FormState = { name: '', email: '', phone: '', message: '' };

export default function Quiz({
  options,
  businessName,
  phoneDisplay,
  telHref,
  sourcePage,
  productSlug = '',
  heading = 'What are you shopping for?',
  variant = 'primary',
}: Props) {
  const { step, category, categoryLabel } = useStore(quizStore);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Honeypot. A human never sees it, so anything in it is a bot.
  const [company, setCompany] = useState('');

  const set = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  /**
   * Pushes an event to both the dataLayer and Zaraz.
   *
   * Zaraz reads the dataLayer, but calling `zaraz.track` directly is the
   * documented path and works even when dataLayer compatibility is off. Doing
   * both costs nothing and removes a whole class of "the tag never fired"
   * debugging.
   */
  function track(eventName: string, payload: Record<string, unknown>) {
    const w = window as unknown as {
      dataLayer?: unknown[];
      zaraz?: { track?: (name: string, data: Record<string, unknown>) => void };
    };
    w.dataLayer = w.dataLayer || [];
    w.dataLayer.push({ event: eventName, ...payload });
    try {
      w.zaraz?.track?.(eventName, payload);
    } catch {
      /* A tag manager failing must never break the form. */
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    // The honeypot verdict lives on the SERVER (validateLead) — a single
    // decider that also catches bots POSTing straight to the API. The field
    // is still submitted below; the client no longer pre-empts it, so every
    // drop is server-logged instead of silently swallowed here (I-07).

    setSubmitting(true);
    const clientEventId = crypto.randomUUID();

    try {
      const res = await fetch('/api/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          company, // honeypot — the server is the decider (validateLead)
          category,
          productSlug,
          sourcePage,
          eventId: clientEventId,
          consentVersion: CONSENT_VERSION,
        }),
      });

      const data = (await res.json()) as {
        ok: boolean;
        error?: string;
        eventId?: string;
        leadUuid?: string;
        duplicate?: boolean;
      };

      if (!data.ok) {
        setError(data.error ?? 'Something went wrong. Please call us instead.');
        setSubmitting(false);
        return;
      }

      // THE ONLY GATE ON THE BROWSER CONVERSION IS DUPLICATE STATUS
      // (gate-enforced). A CRM or CAPI failure is a server problem the
      // browser cannot see and must not gate on; a duplicate means the
      // conversion for this human already counted inside 24h, and firing
      // the browser half again would teach Meta to buy them twice.
      if (!data.duplicate) {
        // THE DEDUP KEY. Use the id the SERVER recorded, not the one this
        // component generated — if they ever diverge, the server's is the one
        // written to lead_events and sent to the Conversions API, so matching
        // it here is what makes Meta count one lead instead of two.
        const eventId = data.eventId ?? clientEventId;

        const [firstName = '', ...rest] = form.name.trim().split(' ');
        track('lead_submit', {
          event_id: eventId,
          lead_uuid: data.leadUuid,
          category,
          category_label: categoryLabel,
          product_slug: productSlug,
          source_page: sourcePage,
          currency: 'USD',
          // Meta's Automatic Advanced Matching hashes these in the browser.
          // They are never logged by us; they go straight to the tag.
          email: form.email,
          phone: form.phone,
          first_name: firstName,
          last_name: rest.join(' '),
        });

        // Tell the server the browser half fired, so the audit row can show
        // 1/1 rather than leaving the client side permanently unknown. A
        // suppressed duplicate fired nothing, so it PATCHes nothing.
        void fetch('/api/lead', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventId }),
          keepalive: true,
        }).catch(() => undefined);
      }

      // A short beat so the tag manager's beacon leaves before navigation.
      // Zaraz sends server-side, but the client still has to hand it over.
      await new Promise((r) => setTimeout(r, 250));

      window.location.href = `/thank-you?ref=${encodeURIComponent(category || 'general')}`;
    } catch {
      setError('We could not send that. Please call us instead.');
      setSubmitting(false);
    }
  }

  if (step === 1) {
    return (
      <section className={`quiz quiz--${variant}`} aria-labelledby={`quiz-h-${variant}`}>
        <h2 className="quiz-h" id={`quiz-h-${variant}`}>
          {heading}
        </h2>
        <p className="quiz-sub">Pick one and we'll show you what's on the floor.</p>

        <div className="quiz-options">
          {options.map((opt) => (
            <button
              key={opt.slug || 'browsing'}
              type="button"
              className="quiz-option"
              onClick={() => {
                selectCategory(opt.slug, opt.label);
                track('product_style_selected', {
                  category: opt.slug,
                  category_label: opt.label,
                  source_page: sourcePage,
                });
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className={`quiz quiz--${variant}`} aria-labelledby={`quiz-h2-${variant}`}>
      <h2 className="quiz-h" id={`quiz-h2-${variant}`}>
        Where should we send your pricing?
      </h2>
      <p className="quiz-sub">
        {categoryLabel ? `Looking at: ${categoryLabel}. ` : ''}
        <button type="button" className="quiz-change" onClick={resetQuiz}>
          Change
        </button>
      </p>

      <form onSubmit={handleSubmit} className="quiz-form" noValidate>
        {/* Honeypot — off-screen, never announced, never autofilled. */}
        <div className="quiz-hp" aria-hidden="true">
          <label htmlFor={`company-${variant}`}>Company</label>
          <input
            id={`company-${variant}`}
            name="company"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
          />
        </div>

        <label className="quiz-label" htmlFor={`name-${variant}`}>
          Full name
        </label>
        <input
          id={`name-${variant}`}
          name="name"
          type="text"
          required
          autoComplete="name"
          value={form.name}
          onChange={set('name')}
          className="quiz-input"
        />

        <label className="quiz-label" htmlFor={`phone-${variant}`}>
          Phone
        </label>
        <input
          id={`phone-${variant}`}
          name="phone"
          type="tel"
          inputMode="tel"
          required
          autoComplete="tel"
          value={form.phone}
          onChange={set('phone')}
          className="quiz-input"
        />

        <label className="quiz-label" htmlFor={`email-${variant}`}>
          Email
        </label>
        <input
          id={`email-${variant}`}
          name="email"
          type="email"
          inputMode="email"
          required
          autoComplete="email"
          value={form.email}
          onChange={set('email')}
          className="quiz-input"
        />

        <label className="quiz-label" htmlFor={`message-${variant}`}>
          Anything we should know? <span className="quiz-optional">(optional)</span>
        </label>
        <textarea
          id={`message-${variant}`}
          name="message"
          rows={2}
          autoComplete="off"
          value={form.message}
          onChange={set('message')}
          className="quiz-input"
        />

        {error && (
          <p className="quiz-error" role="alert">
            {error}{' '}
            <a href={telHref}>Call {phoneDisplay}</a>
          </p>
        )}

        <button type="submit" className="btn btn-gold btn-block quiz-submit" disabled={submitting}>
          {submitting ? 'Sending…' : 'Get my pricing →'}
        </button>

        <p className="quiz-consent">{consentTextFor(CONSENT_VERSION, businessName)}</p>
      </form>
    </section>
  );
}
