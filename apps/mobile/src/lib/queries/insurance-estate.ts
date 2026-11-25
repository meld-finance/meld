import type {
  BankNumberResult,
  EstateDesignationInput,
  EstateDocument,
  EstateDocumentInput,
  EstateSettings,
  EstateSummary,
  InsurancePolicy,
  InsurancePolicyInput,
  LeaveToWillInput,
  PolicyExtraction,
  UploadedDocument,
} from '@meld/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../api';
import { keys } from './keys';

export function useInsurancePolicies() {
  return useQuery({ queryKey: keys.insurance, queryFn: () => api<InsurancePolicy[]>('/insurance') });
}

export function useInsurancePolicy(id: string | undefined) {
  return useQuery({
    queryKey: [...keys.insurance, id],
    queryFn: () => api<InsurancePolicy>(`/insurance/${id}`),
    enabled: !!id,
  });
}

export function useSavePolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: InsurancePolicyInput }) =>
      api<InsurancePolicy>(id ? `/insurance/${id}` : '/insurance', {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify(input),
      }),
    // Life policies' beneficiaries show on the Estate tab too.
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: keys.insurance }), qc.invalidateQueries({ queryKey: keys.estate })]),
  });
}

export function useDeletePolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/insurance/${id}`, { method: 'DELETE' }),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: keys.insurance }), qc.invalidateQueries({ queryKey: keys.estate })]),
  });
}

export function useEstate() {
  return useQuery({ queryKey: keys.estate, queryFn: () => api<EstateSummary>('/estate') });
}

/** Estate changes can open or clear alerts, which the server rechecks just after saving. */
function useInvalidateEstate() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: keys.estate });
    setTimeout(() => void qc.invalidateQueries({ queryKey: keys.alerts, exact: true }), 1_500);
  };
}

export function useSaveDesignation() {
  const invalidate = useInvalidateEstate();
  return useMutation({
    mutationFn: (input: EstateDesignationInput) => api('/estate/designations', { method: 'PUT', body: JSON.stringify(input) }),
    onSuccess: invalidate,
  });
}

/** Marks accounts and assets as passing by will, e.g. everything still flagged for probate. */
export function useLeaveToWill() {
  const invalidate = useInvalidateEstate();
  return useMutation({
    mutationFn: (input: LeaveToWillInput) =>
      api<{ updated: number }>('/estate/designations/will', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: invalidate,
  });
}

/** Looks up a linked bank account's full number through Plaid, to fill in the designation form. */
export function useBankNumber() {
  return useMutation({
    mutationFn: (accountId: string) => api<BankNumberResult>(`/estate/accounts/${accountId}/bank-number`, { method: 'POST' }),
  });
}

export function useEstateDocument(id: string | undefined) {
  return useQuery({
    queryKey: [...keys.estate, 'documents', id],
    queryFn: () => api<EstateDocument>(`/estate/documents/${id}`),
    enabled: !!id,
  });
}

export function useSaveEstateDocument() {
  const invalidate = useInvalidateEstate();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: EstateDocumentInput }) =>
      api<EstateDocument>(id ? `/estate/documents/${id}` : '/estate/documents', {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: invalidate,
  });
}

export function useDeleteEstateDocument() {
  const invalidate = useInvalidateEstate();
  return useMutation({
    mutationFn: (id: string) => api(`/estate/documents/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}

export function useSaveEstateSettings() {
  const invalidate = useInvalidateEstate();
  return useMutation({
    mutationFn: (settings: EstateSettings) => api<EstateSettings>('/estate/settings', { method: 'PUT', body: JSON.stringify(settings) }),
    onSuccess: invalidate,
  });
}

/** Uploads a policy PDF and returns a draft to review; nothing is saved yet. */
export function useExtractPolicy() {
  return useMutation({
    mutationFn: (form: FormData) => api<PolicyExtraction>('/insurance/extract', { method: 'POST', body: form }),
  });
}

/** Stores a PDF to keep with a policy (no AI); it's attached when the policy is saved with its id. */
export function useUploadDocument() {
  return useMutation({
    mutationFn: (form: FormData) => api<UploadedDocument>('/documents', { method: 'POST', body: form }),
  });
}

/** Drops an uploaded document whose draft was abandoned. */
export function discardDocument(documentId: string) {
  return api(`/documents/${documentId}`, { method: 'DELETE' }).catch(() => undefined);
}
