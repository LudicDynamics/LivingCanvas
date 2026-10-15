/**
 * 「模型与密钥」: 「使用 Worldlines 额度」 ↔, in the
 * account panel and in 「语音与连接」. Only on the browser version on the
 * Worldlines gateway (lib/local-key.ts localKeyAvailable).
 *
 * Several providers, one per job
 * the four jobs — 对话 / 生图 / 语音合成 TTS /
 * 语音识别 STT — are always shown as a table, one provider + model per row (rows
 * wait, disabled, with the providers that could do them until such a key is
 * added); below it the providers in this browser and 「再添加一个服务商」. Adding a
 * provider shows what it can do and takes the jobs still on Worldlines; a job
 * already on another key is offered, never taken. A custom OpenAI-compatible
 * service does the jobs the player ticks. Each row's 「测试」 only reads the
 * provider's model list (no generation, nothing spent).
 *
 * Keys stay in this browser and go from this tab straight to the provider;
 * Voice Live and the studio voices stay on Worldlines. Switching applies from
 * the next request.
 */
import { track } from '../../lib/analytics.js';
import { useId, useState, useSyncExternalStore, type ChangeEvent } from 'react';
import { useLocale } from '../../lib/i18n.js';
import { localTtsFeature } from '../../lib/tts-readiness.js';
import {
  BROWSER_BLOCKED_PROVIDERS, CAPABILITIES, LOCAL_KEY_PRESETS, TTS_VOICES, WORLDLINES, capabilitiesOf, chatKeyLabel, chooseFor,
  forgetLocalKey, keyLabel, keyPlan, keyProblem, keysFromEnvFile, localKeyAvailable, localKeySettings, maskKey, presetOf,
  presetsFor, removeKey, runtimeRoutes, saveLocalKey, setKeyCaps, subscribeLocalKey, supports, testJob, testKey, upsertKey,
  type Capability, type JobModels, type JobTestResult, type KeyEntry, type LocalKeySettings as Settings, type PresetId, type TestResult,
} from '../../lib/local-key.js';

type T = (k: string, v?: Record<string, string | number>) => string;

/**: said next to the switch and in the key form, never behind a tooltip. */
function KeyPromise({ testId }: { testId: string }) {
  const { t } = useLocale();
  return <p className="local-key__notice" data-testid={testId}>{t('Your key is saved only in this browser on this device. Worldlines never uploads, stores or forwards your key; with a local key, requests go from your browser straight to the provider you choose, never through Worldlines servers.')}</p>;
}

/** The current chat source in a few words, for the plan line (「对话：本机密钥（DeepSeek）」). */
export function useChatSourceLine(): string | null {
  const { t } = useLocale();
  const available = useSyncExternalStore(subscribeLocalKey, localKeyAvailable, () => false);
  const settings = useSyncExternalStore(subscribeLocalKey, localKeySettings, localKeySettings);
  if (!available) return null;
  const label = chatKeyLabel(settings);
  return label ? t('Chat: local key ({provider})', { provider: label }) : t('Chat: Worldlines credits');
}

/** The four jobs, as the table names them. */
const JOB_LABEL: Record<Capability, string> = {
  chat: 'Chat',
  image: 'Image generation',
  tts: 'Speech synthesis (TTS)',
  stt: 'Speech recognition (STT)',
};
const JOB_HINT: Record<Capability, string> = {
  chat: 'The writer and the characters',
  image: 'Scene images and covers',
  tts: 'Character voices',
  stt: 'Your voice input',
};

const jobList = (t: T, caps: readonly Capability[]) => caps.map((c) => t(JOB_LABEL[c])).join(' · ');

function testText(t: T, r: TestResult): { text: string; error: boolean } {
  if (r.ok) return { text: r.models.length ? t('Connected. The key works ({count} models).', { count: r.models.length }) : t('Connected. The key works.'), error: false };
  if (r.reason === 'invalid') return { text: t(r.problem ?? 'Enter your API key.'), error: true };
  if (r.reason === 'unauthorized') return { text: t('The provider refused this key ({status}).', { status: r.status ?? 401 }), error: true };
  if (r.reason === 'blocked') return { text: t('Could not reach the provider from this browser. Check the address; some services do not allow browser calls (CORS).'), error: true };
  return { text: t('The provider answered with an error ({status}).', { status: r.status ?? 0 }), error: true };
}

function jobTestText(t: T, r: JobTestResult, model: string): { text: string; error: boolean } {
  if (r.ok) {
    if (r.listed === true) return { text: t('OK: {model} is available with this key (nothing was generated).', { model }), error: false };
    if (r.listed === false) return { text: t("The key works, but {model} is not in this provider's model list. Check the model name.", { model }), error: true };
    return { text: t('The key works. This provider does not list its models, so the model name could not be checked.'), error: false };
  }
  if (r.reason === 'no-model') return { text: t('Enter a model first.'), error: true };
  if (r.reason === 'unsupported') return { text: t('This provider cannot do this job.'), error: true };
  return testText(t, r as TestResult);
}

const presetName = (t: T, id: PresetId) => (id === 'custom' ? t(presetOf(id).label) : presetOf(id).label);

type Form = Omit<KeyEntry, 'id'> & { caps: Capability[] };
const emptyForm = (preset: PresetId = 'deepseek'): Form => ({ preset, base: presetOf(preset).base, key: '', caps: ['chat'] });

export function LocalKeySettings({ compact = false }: { compact?: boolean }) {
  const { t } = useLocale();
  const id = useId();
  const available = useSyncExternalStore(subscribeLocalKey, localKeyAvailable, () => false);
  const saved = useSyncExternalStore(subscribeLocalKey, localKeySettings, localKeySettings);
  const [open, setOpen] = useState(!compact);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<Form>(() => emptyForm());
  const [formModels, setFormModels] = useState<JobModels>({});
  const [found, setFound] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);
  const [jobStatus, setJobStatus] = useState<Partial<Record<Capability, { text: string; error: boolean }>>>({});
  /** After a save: the jobs the new provider could do that stay on another key (asked, never taken). */
  const [offer, setOffer] = useState<{ keyId: string; caps: Capability[] } | null>(null);
  if (!available) return null;

  const local = saved.source === 'local';
  const routes = runtimeRoutes(saved);
  const apply = (next: Settings, text?: string) => {
    const ok = saveLocalKey(next);
    setStatus(!ok ? { text: t('This browser does not allow saving here; the key is used until you close this tab.'), error: true } : text ? { text, error: false } : null);
  };

  const pickSource = (source: Settings['source']) => {
    if (source === 'worldlines') { apply({ ...saved, source }, t('Everything now uses your Worldlines account.')); return; }
    setOpen(true);
    if (!saved.keys.length) setAdding(true);
    apply({ ...saved, source }, saved.keys.length ? t('Your local keys are in use from the next request.') : undefined);
  };
  const pickPreset = (value: PresetId) => setForm({ ...form, preset: value, base: presetOf(value).base || (form.preset === 'custom' ? form.base : '') });
  const formCaps = capabilitiesOf(form);
  const plan = keyPlan(saved, form);
  const nameOf = (keyId: string) => { const k = saved.keys.find((x) => x.id === keyId); return k ? keyLabel(k) : ''; };

  const addKey = (entry: Form, models: JobModels = {}) => {
    const problem = keyProblem(entry);
    if (problem) { setStatus({ text: t(problem), error: true }); return false; }
    if (entry.preset === 'custom' && !entry.caps.length) { setStatus({ text: t('Tick at least one job this service can do.'), error: true }); return false; }
    const before = { ...saved, source: 'local' as const };
    const next = upsertKey(before, entry.preset === 'custom' ? entry : { preset: entry.preset, base: entry.base, key: entry.key }, models);
    const added = next.keys[next.keys.length - 1];
    const took = CAPABILITIES.filter((cap) => next.use[cap].via === added.id);
    const left = keyPlan(before, added).elsewhere.map((e) => e.cap);
    apply(next, took.length
      ? t('{provider} saved in this browser. It now does: {jobs}. In use from the next request.', { provider: keyLabel(added), jobs: jobList(t, took) })
      : t('{provider} saved in this browser. Every job it can do already uses another key; move one in the table above.', { provider: keyLabel(added) }));
    setOffer(left.length ? { keyId: added.id, caps: left } : null);
    // 改进产品 (lib/analytics.ts): which provider preset — never the key or its address.
    track('local_key_enabled', { provider: added.preset });
    return true;
  };
  const submit = () => {
    if (addKey(form, form.preset === 'custom' ? formModels : {})) { setForm(emptyForm(form.preset === 'deepseek' ? 'openai' : 'deepseek')); setFormModels({}); setAdding(false); }
  };
  const test = async (entry: Pick<KeyEntry, 'preset' | 'base' | 'key'>, keyId?: string) => {
    setBusy(true);
    setStatus(null);
    const r = await testKey(entry, window.fetch.bind(window));
    setBusy(false);
    if (r.ok && keyId) setFound({ ...found, [keyId]: r.models });
    setStatus(testText(t, r));
  };
  const runJobTest = async (cap: Capability) => {
    const choice = saved.use[cap];
    const entry = saved.keys.find((k) => k.id === choice.via);
    if (!entry) return;
    setBusy(true);
    setJobStatus({ ...jobStatus, [cap]: undefined });
    const r = await testJob(entry, cap, choice.model, window.fetch.bind(window));
    setBusy(false);
    if (r.ok && r.models.length) setFound((f) => ({ ...f, [entry.id]: r.models }));
    setJobStatus((s) => ({ ...s, [cap]: jobTestText(t, r, choice.model.trim()) }));
  };
  // 「从 .env.local 读取」: read here, in this page — the file is never uploaded.
  const importEnv = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const keys = file.size <= 256 * 1024 ? keysFromEnvFile(await file.text().catch(() => '')) : [];
    if (!keys.length) { setStatus({ text: t('No DEEPSEEK_API_KEY or OPENAI_API_KEY found in that file.'), error: true }); return; }
    let next: Settings = { ...saved, source: 'local' };
    for (const k of keys) next = upsertKey(next, k);
    apply(next, t('Read {count} key(s) from the file in this page only; they are in use from the next request.', { count: keys.length }));
    setAdding(false);
  };
  const clear = () => {
    forgetLocalKey();
    setFound({});
    setOffer(null);
    setJobStatus({});
    setStatus({ text: t('All local keys were removed from this browser. Everything uses your Worldlines account.'), error: false });
  };
  const remove = (k: KeyEntry) => {
    const freed = CAPABILITIES.filter((cap) => saved.use[cap].via === k.id);
    apply(removeKey(saved, k.id), freed.length
      ? t('{provider} removed from this browser. Back on your Worldlines account: {jobs}.', { provider: keyLabel(k), jobs: jobList(t, freed) })
      : t('Key removed from this browser.'));
    if (offer?.keyId === k.id) setOffer(null);
  };
  const offerKey = offer ? saved.keys.find((k) => k.id === offer.keyId) : undefined;

  return (
    <fieldset className="local-key" data-testid="local-key" data-source={local ? 'local' : 'worldlines'}>
      <legend className="local-key__legend">{t('Models and keys')}</legend>
      <KeyPromise testId="local-key-promise" />
      <label className="local-key__choice">
        <input type="radio" name={`${id}-source`} checked={!local} onChange={() => pickSource('worldlines')} />
        {t('Use Worldlines credits')}
      </label>
      <label className="local-key__choice">
        <input type="radio" name={`${id}-source`} checked={local} onChange={() => pickSource('local')} />
        {t('Use local keys')}
      </label>
      {local && compact && (
        <button type="button" className="local-key__toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? t('Hide key settings') : t('Key settings')}</button>
      )}
      {local && !Object.keys(routes).length && <p className="account-panel__note" role="status">{t('No local key is in use yet, so everything still uses your Worldlines account.')}</p>}
      {local && open && (
        <div className="local-key__body">
          <p className="account-panel__note">{t('With a local key your provider bills that use directly: it does not spend Worldlines credits, and the credit numbers here do not move.')}</p>
          <p className="local-key__lead" data-testid="local-key-multi">{t('Each job can use a different provider: for example chat on DeepSeek, character voices and images on OpenAI, voice input on Groq.')}</p>

          <table className="local-key__jobs" data-testid="local-key-jobs">
            <caption className="local-key__caption">{t('Who does each job')}</caption>
            <thead><tr><th scope="col">{t('Job')}</th><th scope="col">{t('Provider and model')}</th></tr></thead>
            <tbody>
              {CAPABILITIES.map((cap) => {
                const choice = saved.use[cap];
                const entry = saved.keys.find((k) => k.id === choice.via && supports(k, cap));
                const options = saved.keys.filter((k) => supports(k, cap));
                const models = [...new Set([...(entry ? presetOf(entry.preset).models[cap] ?? [] : []), ...(entry ? found[entry.id] ?? [] : [])])];
                const result = jobStatus[cap];
                return (
                  <tr key={cap} className="local-key__use" data-capability={cap} data-via={entry ? entry.preset : WORLDLINES} aria-disabled={options.length ? undefined : true}>
                    <th scope="row" className="local-key__job">
                      <span>{t(JOB_LABEL[cap])}</span>
                      <small>{t(JOB_HINT[cap])}</small>
                    </th>
                    <td className="local-key__job-td"><div className="local-key__job-cell">
                      <select aria-label={t('Provider for {job}', { job: t(JOB_LABEL[cap]) })} disabled={!options.length} value={entry ? entry.id : WORLDLINES}
                        onChange={(e) => { setJobStatus({ ...jobStatus, [cap]: undefined }); apply(chooseFor(saved, cap, e.target.value)); }}>
                        <option value={WORLDLINES}>{t('Worldlines account')}</option>
                        {options.map((k) => <option key={k.id} value={k.id}>{options.filter((o) => keyLabel(o) === keyLabel(k)).length > 1 ? `${keyLabel(k)} · ${maskKey(k.key)}` : keyLabel(k)}</option>)}
                      </select>
                      {!options.length && (
                        <small className="local-key__hint">{t('Add a provider that can do this first: {list}', { list: [...presetsFor(cap).map((p) => p.label), t('Other OpenAI-compatible service')].join(', ') })}</small>
                      )}
                      {entry && (
                        <>
                          <input aria-label={t('Model for {job}', { job: t(JOB_LABEL[cap]) })} list={`${id}-${cap}-models`} autoComplete="off" spellCheck={false} placeholder={t('Model')} value={choice.model}
                            onChange={(e) => { setJobStatus({ ...jobStatus, [cap]: undefined }); apply(chooseFor(saved, cap, entry.id, e.target.value)); }} />
                          <datalist id={`${id}-${cap}-models`}>{models.map((m) => <option key={m} value={m} />)}</datalist>
                          {cap === 'tts' && (
                            <label className="account-panel__field">{t('Voice for characters without a matching voice')}
                              <select value={choice.voice ?? 'coral'} onChange={(e) => apply({ ...saved, use: { ...saved.use, tts: { ...choice, voice: e.target.value } } })}>
                                {TTS_VOICES.map((v) => <option key={v} value={v}>{v}</option>)}
                              </select>
                            </label>
                          )}
                          <span className="local-key__row">
                            <button type="button" className="account-panel__secondary" data-testid={`local-key-test-${cap}`} disabled={busy} onClick={() => void runJobTest(cap)}>{t('Test')}</button>
                            {!choice.model.trim() && <small className="local-key__hint">{t('Enter a model first.')}</small>}
                          </span>
                          {result && <small className={`local-key__result${result.error ? ' local-key__result--error' : ''}`} role={result.error ? 'alert' : 'status'}>{result.text}</small>}
                        </>
                      )}
                    </div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="local-key__hint">{t("Test only reads the provider's model list and checks the model name: nothing is generated and nothing is spent.")}</p>

          {offer && offerKey && (
            <div className="local-key__offer" role="group" data-testid="local-key-offer" aria-label={t('{provider} can also do these jobs', { provider: keyLabel(offerKey) })}>
              <p className="local-key__lead">{t('{provider} can also do these jobs, which use another key now. Move them?', { provider: keyLabel(offerKey) })}</p>
              <span className="local-key__row">
                {offer.caps.map((cap) => (
                  <button key={cap} type="button" className="account-panel__secondary" onClick={() => {
                    apply(chooseFor(saved, cap, offerKey.id));
                    const rest = offer.caps.filter((c) => c !== cap);
                    setOffer(rest.length ? { ...offer, caps: rest } : null);
                  }}>{t('{job}: use {provider} instead of {current}', { job: t(JOB_LABEL[cap]), provider: keyLabel(offerKey), current: nameOf(saved.use[cap].via) || t('Worldlines account') })}</button>
                ))}
                <button type="button" className="local-key__toggle" onClick={() => setOffer(null)}>{t('Keep as is')}</button>
              </span>
            </div>
          )}

          {saved.keys.length > 0 && (
            <ul className="local-key__keys" aria-label={t('Providers in this browser')}>
              {saved.keys.map((k) => {
                const doing = CAPABILITIES.filter((cap) => saved.use[cap].via === k.id);
                return (
                  <li key={k.id} className="local-key__key" data-preset={k.preset}>
                    <span className="local-key__key-name">{keyLabel(k)} · <code>{maskKey(k.key)}</code></span>
                    <small className="local-key__hint">{t('Can do: {jobs}', { jobs: jobList(t, capabilitiesOf(k)) })}{' — '}{doing.length ? t('In use for: {jobs}', { jobs: jobList(t, doing) }) : t('Not in use for any job')}</small>
                    {k.preset === 'custom' && (
                      <span className="local-key__caps" role="group" aria-label={t('Jobs this service can do')}>
                        {CAPABILITIES.map((cap) => (
                          <label key={cap} className="local-key__cap">
                            <input type="checkbox" checked={supports(k, cap)} onChange={(e) => {
                              const caps = e.target.checked ? [...capabilitiesOf(k), cap] : capabilitiesOf(k).filter((c) => c !== cap);
                              apply(setKeyCaps(saved, k.id, caps));
                            }} />
                            {t(JOB_LABEL[cap])}
                          </label>
                        ))}
                      </span>
                    )}
                    <span className="local-key__row">
                      <button type="button" className="account-panel__secondary" disabled={busy} onClick={() => void test(k, k.id)}>{t('Test connection')}</button>
                      <button type="button" className="account-panel__secondary" disabled={busy} onClick={() => remove(k)}>{t('Remove')}</button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          {!adding && (
            <button type="button" className="local-key__toggle local-key__add-another" data-testid="local-key-add" onClick={() => { setAdding(true); setOffer(null); }}>
              {saved.keys.length ? t('Add another provider (for example voices on OpenAI, chat on DeepSeek)') : t('Add a provider')}
            </button>
          )}
          {adding && (
            <div className="local-key__add">
              <KeyPromise testId="local-key-notice" />
              <label className="account-panel__field">{t('Provider')}
                <select value={form.preset} onChange={(e) => pickPreset(e.target.value as PresetId)}>
                  {LOCAL_KEY_PRESETS.map((p) => <option key={p.id} value={p.id}>{presetName(t, p.id)}</option>)}
                </select>
              </label>
              {form.preset !== 'custom' ? (
                <ul className="local-key__can" aria-label={t('What this provider can do here')} data-testid="local-key-can">
                  {CAPABILITIES.map((cap) => (
                    <li key={cap} data-can={formCaps.includes(cap) ? 'yes' : 'no'}>{formCaps.includes(cap) ? '✓' : '—'} {t(JOB_LABEL[cap])}</li>
                  ))}
                </ul>
              ) : (
                <div className="local-key__caps local-key__caps--form" role="group" aria-label={t('Which jobs does this service support?')}>
                  <span className="local-key__lead">{t('Which jobs does this service support?')}</span>
                  {CAPABILITIES.map((cap) => (
                    <div key={cap} className="local-key__cap-row">
                      <label className="local-key__cap">
                        <input type="checkbox" checked={form.caps.includes(cap)} onChange={(e) => setForm({ ...form, caps: e.target.checked ? CAPABILITIES.filter((c) => c === cap || form.caps.includes(c)) : form.caps.filter((c) => c !== cap) })} />
                        {t(JOB_LABEL[cap])}
                      </label>
                      {form.caps.includes(cap) && (
                        <input aria-label={t('Model for {job}', { job: t(JOB_LABEL[cap]) })} autoComplete="off" spellCheck={false} placeholder={t('Model')} value={formModels[cap] ?? ''} onChange={(e) => setFormModels({ ...formModels, [cap]: e.target.value })} />
                      )}
                    </div>
                  ))}
                </div>
              )}
              {plan.takes.length > 0 && <p className="local-key__hint" data-testid="local-key-plan">{t('When saved it takes: {jobs} (now on your Worldlines account).', { jobs: jobList(t, plan.takes) })}</p>}
              {plan.elsewhere.length > 0 && <p className="local-key__hint">{t('Already on another key, left there unless you move them: {jobs}.', { jobs: plan.elsewhere.map((e) => `${t(JOB_LABEL[e.cap])} (${nameOf(e.via)})`).join(' · ') })}</p>}
              <p className="account-panel__note">{t('Not available here (the provider does not allow browser calls): {list}', { list: BROWSER_BLOCKED_PROVIDERS.join(', ') })}</p>
              <label className="account-panel__field">{t('API address (OpenAI-compatible)')}
                <input type="url" inputMode="url" autoComplete="off" spellCheck={false} placeholder="https://…/v1" value={form.base} onChange={(e) => setForm({ ...form, base: e.target.value })} />
              </label>
              <label className="account-panel__field">{t('API key')}
                <input type="password" autoComplete="off" spellCheck={false} placeholder="sk-…" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} />
              </label>
              <div className="local-key__row">
                <button type="button" className="account-panel__action" disabled={busy} onClick={submit}>{t('Save and use')}</button>
                <button type="button" className="account-panel__secondary" disabled={busy} onClick={() => void test(form)}>{busy ? t('Working…') : t('Test connection')}</button>
                {saved.keys.length > 0 && <button type="button" className="local-key__toggle" onClick={() => setAdding(false)}>{t('Cancel')}</button>}
              </div>
              <label className="local-key__import">{t('Or read keys from your local LivingCanvas .env.local (read in this page only, never uploaded)')}
                <input type="file" accept=".local,.env,text/plain" onChange={(e) => void importEnv(e)} />
              </label>
            </div>
          )}

          <ul className="local-key__stays">
            <li>{t('Voice Live calls stay on your Worldlines account (the browser version cannot use your key for them yet).')}</li>
            {localTtsFeature() && <li>{t("Studio character voices (such as Nanami's) stay on your Worldlines account; when it is not reachable, those characters speak with your provider's standard voice.")}</li>}
            <li>{t('Anything not set to a local key uses your Worldlines account.')}</li>
          </ul>
          {saved.keys.length > 0 && <button type="button" className="account-panel__secondary" disabled={busy} onClick={clear}>{t('Remove all local keys')}</button>}
        </div>
      )}
      {status && <p className={`account-panel__status${status.error ? ' account-panel__status--error' : ''}`} role={status.error ? 'alert' : 'status'}>{status.text}</p>}
    </fieldset>
  );
}
