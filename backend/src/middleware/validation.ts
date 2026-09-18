import type { RequestHandler } from 'express';
import { HttpError } from '../lib/errors.js';
export function positiveId(value: unknown): boolean {
  return (typeof value === 'number' || typeof value === 'string') && /^\d+$/.test(String(value)) &&
    Number.isSafeInteger(Number(value)) && Number(value) > 0 && Number(value) <= 2147483647;
}
export function validateRecord(b: any) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new HttpError(400, 'INVALID_INPUT', 'מבנה נתונים לא תקין');
  for (const [key, value] of Object.entries(b)) {
    if (['jobId', 'clientId', 'personId'].includes(key) && value !== '' && value !== null && !positiveId(value))
      throw new HttpError(400, 'INVALID_ID', `מזהה לא תקין: ${key}`);
    if (['interviewedTeams', 'gotTask', 'sentToClient', 'clientApproved', 'rejectionLetterSent', 'doNotRehire', 'includesCar', 'travelBetweenSites', 'noAnswer', 'dryRun'].includes(key) && value !== null && typeof value !== 'boolean')
      throw new HttpError(400, 'INVALID_BOOLEAN', `ערך לא תקין: ${key}`);
    if (['requestDate', 'filledDate', 'contactedAt'].includes(key) && value) {
      const s = String(value), d = new Date(s);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== s)
        throw new HttpError(400, 'INVALID_DATE', `תאריך לא תקין: ${key}`);
    }
    if (key === 'salaryExpectation' && value !== '' && value !== null &&
      (!['string','number'].includes(typeof value) || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 99999999))
      throw new HttpError(400, 'INVALID_SALARY', 'ציפיות שכר לא תקינות');
    if (['notes','summaryText','referral','rejectionReason','doNotRehireReason','description','keywords','contactedAt','requestDate','filledDate','expectedVersion','expectedPersonVersion'].includes(key) && value!=null && (typeof value!=='string' || value.length>800000)) throw new HttpError(400,'INVALID_FIELD',`ערך לא תקין: ${key}`);
    const limits: Record<string, number> = {name:200, title:200, email:200, phone:50, region:60, city:120, nationalId:20,
      role:200, outcomeStatus:60, jobScope:40, employmentType:40, sourceChannel:60, importKey:500,
      contactName:200, contactEmail:200, contactPhone:50};
    if (key in limits && value != null && (typeof value !== 'string' || value.length > limits[key]))
      throw new HttpError(400, 'INVALID_FIELD', `ערך לא תקין: ${key}`);
    if (['name', 'title'].includes(key) && (typeof value !== 'string' || !value.trim()))
      throw new HttpError(400, 'REQUIRED_FIELD', 'יש למלא שם או כותרת');
    if (key === 'requirements' && (value === null || typeof value !== 'object' || Array.isArray(value) || Object.values(value).some(v => typeof v !== 'string')))
      throw new HttpError(400, 'INVALID_REQUIREMENTS', 'דרישות לא תקינות');
  }
}
export const validateInput: RequestHandler = (req, _res, next) => {
  try {
    if (req.params.id && !positiveId(req.params.id)) throw new HttpError(400, 'INVALID_ID', 'מזהה לא תקין');
    if (req.body !== undefined) validateRecord(req.body);
    next();
  } catch (err) { next(err); }
};
