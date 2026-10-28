import type { InsurancePolicyInput, PolicyExtraction } from '@meld/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { PolicyForm } from '@/components/policy-form';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { confirm } from '@/lib/confirm';
import { openDocument } from '@/lib/documents';
import { pickPdf } from '@/lib/pick-pdf';
import { POLICY_TYPE_LABELS } from '@/lib/insurance';
import { discardDocument, useDeletePolicy, useExtractPolicy, useInsurancePolicy, useSavePolicy } from '@/lib/queries';

const goBack = () => (router.canGoBack() ? router.back() : router.replace('/plan'));

export default function PolicyScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const policy = useInsurancePolicy(isNew ? undefined : id);
  const save = useSavePolicy();
  const remove = useDeletePolicy();
  const extract = useExtractPolicy();
  const [extraction, setExtraction] = useState<PolicyExtraction | null>(null);
  const [docError, setDocError] = useState<string | null>(null);

  const back = (
    <Pressable onPress={() => void cancel()}>
      <ThemedText type="linkPrimary">‹ Insurance</ThemedText>
    </Pressable>
  );

  async function cancel() {
    // An upload that never became a policy is deleted rather than left on disk.
    if (extraction) await discardDocument(extraction.documentId);
    goBack();
  }

  async function upload() {
    const picked = await pickPdf();
    if (!picked) return;
    if (extraction) void discardDocument(extraction.documentId);
    setExtraction(null);
    extract.mutate(picked.form, { onSuccess: setExtraction });
  }

  function onSave(input: InsurancePolicyInput) {
    save.mutate({ id: isNew ? undefined : id, input }, { onSuccess: goBack });
  }

  async function onDelete() {
    if (!policy.data) return;
    const ok = await confirm(
      `Delete this ${POLICY_TYPE_LABELS[policy.data.type].toLowerCase()} policy?`,
      policy.data.documentId ? 'Its uploaded document is deleted too.' : 'This can’t be undone.',
      'Delete',
    );
    if (ok) remove.mutate(policy.data.id, { onSuccess: goBack });
  }

  function viewDocument(documentId: string, filename: string) {
    setDocError(null);
    openDocument(documentId, filename).catch((err: Error) => setDocError(err.message));
  }

  if (!isNew && (policy.isPending || policy.isError)) {
    return (
      <Screen title="Policy" actions={back}>
        <ThemedText themeColor={policy.isError ? 'negative' : 'textSecondary'}>
          {policy.isError ? `Couldn’t load this policy: ${policy.error.message}` : 'Loading…'}
        </ThemedText>
      </Screen>
    );
  }

  const existing = policy.data;
  const initial = extraction?.draft ?? existing ?? null;
  const document = extraction
    ? { id: extraction.documentId, filename: extraction.filename }
    : existing?.documentId
      ? { id: existing.documentId, filename: existing.documentFilename ?? 'Policy document' }
      : null;

  return (
    <Screen title={isNew ? 'Add policy' : existing!.carrier} actions={back}>
      {isNew && (
        <Card
          title="Fill in from a PDF"
          subtitle="Upload a policy, certificate or benefits summary and AI will fill in the form. Nothing is saved until you check it and press Save. The PDF is sent to Anthropic to read."
          action={
            <Button
              label={extraction ? 'Use another PDF' : 'Upload PDF'}
              variant="secondary"
              size="small"
              disabled={extract.isPending}
              onPress={() => void upload()}
            />
          }>
          {extract.isPending && (
            <View style={styles.reading}>
              <ActivityIndicator />
              <ThemedText type="small" themeColor="textSecondary">
                Reading the policy. This can take up to a minute…
              </ThemedText>
            </View>
          )}
          {extract.isError && (
            <ThemedText type="small" themeColor="negative">
              {extract.error.message}
            </ThemedText>
          )}
          {extraction && (
            <View style={styles.warnings}>
              <ThemedText type="small">
                Filled in from {extraction.filename}. Check every field against the document before saving.
              </ThemedText>
              {extraction.warnings.map((w) => (
                <ThemedText key={w} type="small" themeColor="warning">
                  • {w}
                </ThemedText>
              ))}
            </View>
          )}
        </Card>
      )}

      {document && (
        <Pressable onPress={() => viewDocument(document.id, document.filename)}>
          <ThemedText type="linkPrimary">View {document.filename} ↗</ThemedText>
        </Pressable>
      )}
      {docError && <ThemedText type="small" themeColor="negative">{docError}</ThemedText>}

      <PolicyForm
        // Remount when a new draft arrives so the form picks up the extracted values.
        key={extraction?.documentId ?? existing?.id ?? 'new'}
        initial={initial}
        saving={save.isPending}
        error={save.error?.message ?? remove.error?.message ?? null}
        onSave={onSave}
        onCancel={() => void cancel()}
        onDelete={existing ? () => void onDelete() : undefined}
        deleting={remove.isPending}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  reading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  warnings: { gap: Spacing.one },
});
