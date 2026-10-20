import { ValidationError } from '../db/errors';
import { validateEffectiveTimestamp, validateLocalDate, validateTimeZone } from '../db/validators';

export interface Rule {
  id: string; version: string; kind: 'SOIL_CHECK'; inspectionDays: number;
  provenance: 'USER_OVERRIDE' | 'PRODUCT_GUIDANCE';
}
export interface Fact { id: string; kind: 'WATERED' | 'MOIST'; occurredAt: string }
export interface RuleInput {
  algorithmVersion: 'rules-v1'; nowUtc: string; timeZone: string;
  generationId: string; cycleId: string; cycleStatus: 'ACTIVE' | 'ENDED'; startLocalDate: string;
  environmentSnapshot: unknown;
  effectiveCareEvents: Fact[]; effectiveObservations: Fact[];
  previousOccurrence: { id: string; occurrenceSeq: number; status: string; dueLocalDate: string } | null;
  weather: { issuedAt: string; expiresAt: string; rainMm: number | null } | null;
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).filter(([,v]) => v !== undefined).sort(([a], [b]) => compare(a,b)).map(([k,v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
export const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export const factOrder = (a: Fact, b: Fact) => compare(a.occurredAt,b.occurredAt) || compare(a.id,b.id);
export async function sha256(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2,'0')).join('');
}
export function interval(days: number): void {
  if (!Number.isInteger(days) || days < 1 || days > 30) throw new ValidationError('확인 간격은 1~30일 정수여야 합니다.');
}
export function localDate(utc: string, timeZone: string): string {
  validateEffectiveTimestamp(utc); validateTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year:'numeric',month:'2-digit',day:'2-digit' }).formatToParts(new Date(utc));
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function addDays(date: string, days: number): string {
  validateLocalDate(date);
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0,10);
}
export function normalizedInput(input: RuleInput): RuleInput {
  const facts = (rows: Fact[]) => rows.map(r => ({...r, occurredAt: validateEffectiveTimestamp(r.occurredAt)})).sort(factOrder);
  return {...input, nowUtc: validateEffectiveTimestamp(input.nowUtc), effectiveCareEvents:facts(input.effectiveCareEvents), effectiveObservations:facts(input.effectiveObservations)};
}
export function evaluateSchedule(input: RuleInput, rule: Rule | null) {
  const i = normalizedInput(input);
  validateLocalDate(i.startLocalDate); validateTimeZone(i.timeZone);
  if (i.algorithmVersion !== 'rules-v1' || !['ACTIVE','ENDED'].includes(i.cycleStatus)) throw new ValidationError('잘못된 규칙 입력입니다.');
  if (rule) {
    interval(rule.inspectionDays);
    if (rule.kind !== 'SOIL_CHECK' || !['USER_OVERRIDE','PRODUCT_GUIDANCE'].includes(rule.provenance)) throw new ValidationError('잘못된 규칙입니다.');
  }
  const reasonCodes: string[] = [];
  if (i.weather) {
    const issued = validateEffectiveTimestamp(i.weather.issuedAt), expires = validateEffectiveTimestamp(i.weather.expiresAt);
    if (expires <= issued || (i.weather.rainMm !== null && (!Number.isFinite(i.weather.rainMm) || i.weather.rainMm < 0))) throw new ValidationError('잘못된 기상 입력입니다.');
    reasonCodes.push(i.nowUtc < issued || i.nowUtc >= expires ? 'WEATHER_STALE' : 'WEATHER_NOT_APPLIED');
  }
  if (i.cycleStatus === 'ENDED') return {taskKind:'NONE',occurrenceSeq:null,dueLocalDate:null,recommendationState:'NOT_APPLICABLE',reasonCodes:['CYCLE_ENDED']};
  if (!rule) return {taskKind:'SOIL_CHECK',occurrenceSeq:null,dueLocalDate:null,recommendationState:'UNKNOWN',reasonCodes:['RULE_MISSING']};
  const facts = [...i.effectiveCareEvents,...i.effectiveObservations].sort(factOrder);
  if (facts.some(f => !['WATERED','MOIST'].includes(f.kind))) throw new ValidationError('알 수 없는 관리 기록입니다.');
  const latest = facts.at(-1);
  let due = latest ? addDays(localDate(latest.occurredAt,i.timeZone), latest.kind === 'MOIST' ? Math.min(rule.inspectionDays,2) : rule.inspectionDays) : i.startLocalDate;
  if (i.previousOccurrence?.status === 'SNOOZED') { validateLocalDate(i.previousOccurrence.dueLocalDate); due = i.previousOccurrence.dueLocalDate; }
  reasonCodes.push(i.previousOccurrence?.status === 'SNOOZED' ? 'USER_SNOOZED' : latest?.kind ?? 'CYCLE_START', rule.provenance);
  return {taskKind:'SOIL_CHECK',occurrenceSeq:i.previousOccurrence ? i.previousOccurrence.occurrenceSeq + (i.previousOccurrence.status === 'RESOLVED' ? 1 : 0) : 0,dueLocalDate:due,recommendationState:due <= localDate(i.nowUtc,i.timeZone) ? 'INSPECTION_DUE' : 'INSPECTION_UPCOMING',reasonCodes};
}
export async function evaluate(input: RuleInput, rule: Rule | null) {
  const normalized = normalizedInput(input);
  const output = evaluateSchedule(normalized,rule);
  const [inputDigest,ruleSnapshotHash] = await Promise.all([sha256(canonical(normalized)),sha256(canonical(rule))]);
  return {...output,evidence:{ruleSnapshotId:rule?.id ?? null,inputDigest,ruleSnapshotHash,algorithmVersion:input.algorithmVersion}};
}
