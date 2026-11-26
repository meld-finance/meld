import type { InsurancePolicyInput, PolicyExtraction, UploadedDocument } from '@meld/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AISetupHint } from '@/components/ai-setup-hint';
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
import {
  discardDocument,
  useDeletePolicy,
  useExtractPolicy,
  useFeatures,
  useInsurancePolicy,
  useSavePolicy,
  useUploadDocument,
} from '@/lib/queries';

const goBack = () => (router.canGoBack() ? router.back() : router.replace('/plan'));

type Doc = { id: string; filename: string };
const toDoc = (d: UploadedDocument): Doc => ({ id: d.documentId, filename: d.filename });

export default function PolicyScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const policy = useInsurancePolicy(isNew ? undefined : id);
  const save = useSavePolicy();
  const remove = useDeletePolicy();
  const extract = useExtractPolicy();
  const attach = useUploadDocument();
  const features = useFeatures();
  const [extraction, setExtraction] = useState<PolicyExtraction | null>(null);
  // The document chosen on this screen: undefined keeps the saved one, null removes it.
  const [docChoice, setDocChoice] = useState<Doc | null | undefined>(undefined);
  // Uploads made on this screen. Any not saved with the policy are discarded.
  const uploads = useRef<string[]>([]);
  const [docError, setDocError] = useState<string | null>(null);

  const existing = policy.data;
  const savedDoc: Doc | null = existing?.documentId
    ? { id: existing.documentId, filename: existing.documentFilename ?? 'Policy document' }
    : null;
  const document = docChoice === undefined ? savedDoc : docChoice;
  const busy = extract.isPending || attach.isPending;

  const back = (
    <Pressable onPress={() => void cancel()}>
      <ThemedText type="linkPrimary">‹ Insurance</ThemedText>
    </Pressable>
  );

  /** Discards this screen's uploads other than `keep`; the server keeps any a saved policy uses. */
  function discardUploads(keep?: string | null) {
    const drop = uploads.current.filter((u) => u !== keep);
    uploads.current = uploads.current.filter((u) => u === keep);
    return Promise.all(drop.map(discardDocument));
  }

  async function cancel() {
    await discardUploads();
    goBack();
  }

  function choose(doc: Doc | null) {
    // A replaced upload from this screen won't be needed.
    if (document && uploads.current.includes(document.id)) {
      void discardDocument(document.id);
      uploads.current = uploads.current.filter((u) => u !== document.id);
    }
    if (doc) uploads.current.push(doc.id);
    setDocChoice(doc);
  }

  async function fillFromPdf() {
    const picked = await pickPdf();
    if (!picked) return;
    setExtraction(null);
    extract.mutate(picked.form, {
      onSuccess: (result) => {
        choose(toDoc(result));
        setExtraction(result);
      },
    });
  }

  async function attachPdf() {
    const picked = await pickPdf();
    if (!picked) return;
    attach.mutate(picked.form, { onSuccess: (d) => choose(toDoc(d)) });
  }

  function onSave(input: InsurancePolicyInput) {
    const documentId = document?.id ?? null;
    save.mutate(
      { id: isNew ? undefined : id, input: { ...input, documentId } },
      {
        onSuccess: () => {
          void discardUploads(documentId);
          goBack();
        },
      },
    );
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

  function viewDocument(doc: Doc) {
    setDocError(null);
    openDocument(doc.id, doc.filename).catch((err: Error) => setDocError(err.message));
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

  const initial = extraction?.draft ?? existing ?? null;
  const uploadError = attach.error?.message ?? null;

  return (
    <Screen title={isNew ? 'Add policy' : existing!.carrier} actions={back}>
      {isNew && features.data?.cloudAI && (
        <Card
          title="Fill in from a PDF"
          subtitle={`Upload a policy, certificate or benefits summary and AI will fill in the form. Nothing is saved until you check it and press Save. The PDF is sent to ${features.data.cloudAIProvider === 'openrouter' ? 'OpenRouter and the model’s maker (Google for Gemini)' : 'Anthropic'} to read.`}
          action={
            <Button
              label={extraction ? 'Use another PDF' : 'Upload PDF'}
              variant="secondary"
              size="small"
              disabled={busy}
              onPress={() => void fillFromPdf()}
            />
          }>
          {extract.isPending && (
            <View style={styles.inline}>
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
            <View style={styles.stack}>
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

      <Card
        title="Policy document"
        subtitle="Keep a copy of the policy with it, encrypted on this computer. Attaching doesn’t send it anywhere."
        action={
          <View style={styles.inline}>
            {document && (
              <Button label="Remove" variant="secondary" size="small" disabled={busy} onPress={() => choose(null)} />
            )}
            <Button
              label={document ? 'Replace PDF' : 'Attach PDF'}
              variant="secondary"
              size="small"
              disabled={busy}
              loading={attach.isPending}
              onPress={() => void attachPdf()}
            />
          </View>
        }>
        {document ? (
          <Pressable onPress={() => viewDocument(document)}>
            <ThemedText type="linkPrimary">View {document.filename} ↗</ThemedText>
          </Pressable>
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            {savedDoc ? `${savedDoc.filename} will be removed when you save.` : 'No document attached.'}
          </ThemedText>
        )}
        {document && docChoice !== undefined && savedDoc?.id !== document.id && (
          <ThemedText type="small" themeColor="textSecondary">
            Attached when you save.
          </ThemedText>
        )}
        {isNew && features.data?.cloudAI === false && (
          <AISetupHint
            manual="Copy the details from your policy or benefits summary into the form below."
            aiDoes="read a policy PDF and fill in the form for you"
          />
        )}
        {(uploadError || docError) && (
          <ThemedText type="small" themeColor="negative">
            {uploadError ?? docError}
          </ThemedText>
        )}
      </Card>

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
  inline: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  stack: { gap: Spacing.one },
});
