import type { EquityGrantExtraction, EquityGrantInput, UploadedDocument } from '@meld/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AISetupHint } from '@/components/ai-setup-hint';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { EquityForm } from '@/components/equity-form';
import { Input } from '@/components/form-fields';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { confirm } from '@/lib/confirm';
import { openDocument } from '@/lib/documents';
import { pickPdf } from '@/lib/pick-pdf';
import {
  discardDocument,
  useDeleteEquityGrant,
  useEquityGrant,
  useExtractEquityPdf,
  useExtractEquityText,
  useFeatures,
  useSaveEquityGrant,
  useUploadDocument,
} from '@/lib/queries';

const goBack = () => (router.canGoBack() ? router.back() : router.replace('/accounts?tab=investments&view=equity'));

type Doc = { id: string; filename: string };
const toDoc = (d: UploadedDocument): Doc => ({ id: d.documentId, filename: d.filename });

export default function EquityGrantScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const grant = useEquityGrant(isNew ? undefined : id);
  const save = useSaveEquityGrant();
  const remove = useDeleteEquityGrant();
  const extractPdf = useExtractEquityPdf();
  const extractText = useExtractEquityText();
  const attach = useUploadDocument();
  const features = useFeatures();

  const [extraction, setExtraction] = useState<EquityGrantExtraction | null>(null);
  const [extractionKey, setExtractionKey] = useState(0);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pastedText, setPastedText] = useState('');
  const [docChoice, setDocChoice] = useState<Doc | null | undefined>(undefined);
  const uploads = useRef<string[]>([]);
  const [docError, setDocError] = useState<string | null>(null);

  const existing = grant.data;
  const savedDoc: Doc | null = existing?.documentId
    ? { id: existing.documentId, filename: existing.documentFilename ?? 'Grant document' }
    : null;
  const document = docChoice === undefined ? savedDoc : docChoice;
  const busy = extractPdf.isPending || extractText.isPending || attach.isPending;

  const back = (
    <Pressable onPress={() => void cancel()}>
      <ThemedText type="linkPrimary">‹ Equity</ThemedText>
    </Pressable>
  );

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
    extractPdf.mutate(picked.form, {
      onSuccess: (result) => {
        if (result.documentId && result.filename) choose({ id: result.documentId, filename: result.filename });
        setExtraction(result);
        setExtractionKey((k) => k + 1);
      },
    });
  }

  function fillFromText() {
    if (pastedText.trim().length < 10) return;
    setExtraction(null);
    extractText.mutate(pastedText, {
      onSuccess: (result) => {
        setExtraction(result);
        setExtractionKey((k) => k + 1);
        setPasteOpen(false);
      },
    });
  }

  async function attachPdf() {
    const picked = await pickPdf();
    if (!picked) return;
    attach.mutate(picked.form, { onSuccess: (d) => choose(toDoc(d)) });
  }

  function onSave(input: EquityGrantInput) {
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
    if (!existing) return;
    const ok = await confirm(`Delete ${existing.employer} · ${existing.name}?`, 'This removes the grant and its vesting schedule.', 'Delete');
    if (ok) remove.mutate(existing.id, { onSuccess: goBack });
  }

  function viewDocument(doc: Doc) {
    setDocError(null);
    openDocument(doc.id, doc.filename).catch((err: Error) => setDocError(err.message));
  }

  if (!isNew && (grant.isPending || grant.isError)) {
    return (
      <Screen title="RSU Grant" actions={back}>
        <ThemedText themeColor={grant.isError ? 'negative' : 'textSecondary'}>
          {grant.isError ? `Couldn’t load this grant: ${grant.error.message}` : 'Loading…'}
        </ThemedText>
      </Screen>
    );
  }

  const initial: EquityGrantInput | null =
    extraction?.draft ??
    (existing
      ? {
          kind: existing.kind,
          employer: existing.employer,
          name: existing.name,
          ticker: existing.ticker,
          manualPrice: existing.manualPrice,
          priceAsOf: existing.priceAsOf,
          grantDate: existing.grantDate,
          grantNumberMask: existing.grantNumberMask,
          totalShares: existing.totalShares,
          linkedAccountId: existing.linkedAccountId,
          withholdingMethod: existing.withholdingMethod,
          federalWithholdingRate: existing.federalWithholdingRate,
          stateWithholdingRate: existing.stateWithholdingRate,
          status: existing.status,
          documentId: existing.documentId,
          notes: existing.notes,
          vests: existing.vests.map((v) => ({
            id: v.id,
            vestDate: v.vestDate,
            shares: v.shares,
            status: v.status,
            vestPrice: v.vestPrice,
            sharesWithheld: v.sharesWithheld,
            taxWithheld: v.taxWithheld,
            matchedTxnId: v.matchedTxnId,
          })),
        }
      : null);

  const uploadError = attach.error?.message ?? null;
  const extractError = extractPdf.error?.message ?? extractText.error?.message ?? null;

  return (
    <Screen title={isNew ? 'Add RSU grant' : `${existing!.employer} · ${existing!.name}`} actions={back}>
      {isNew && features.data?.cloudAI && (
        <Card
          title="Fill in with AI"
          subtitle="Upload a grant agreement PDF or paste a vesting table from E*TRADE, Fidelity, Schwab, Shareworks, or Carta. Nothing saves until you check it."
          action={
            <View style={styles.inline}>
              <Button label="Paste table" variant="secondary" size="small" disabled={busy} onPress={() => setPasteOpen((p) => !p)} />
              <Button label={extraction?.documentId ? 'Another PDF' : 'Upload PDF'} variant="secondary" size="small" disabled={busy} onPress={() => void fillFromPdf()} />
            </View>
          }>
          {pasteOpen && (
            <View style={styles.stack}>
              <Input
                value={pastedText}
                onChangeText={setPastedText}
                placeholder="Paste grant summary or vesting rows (dates and shares)…"
                multiline
                style={styles.pasteInput}
              />
              <View style={styles.inline}>
                <Button label="Extract schedule" size="small" disabled={pastedText.trim().length < 10 || busy} loading={extractText.isPending} onPress={fillFromText} />
                <Button label="Close" variant="secondary" size="small" disabled={busy} onPress={() => setPasteOpen(false)} />
              </View>
            </View>
          )}
          {extractPdf.isPending && (
            <View style={styles.inline}>
              <ActivityIndicator />
              <ThemedText type="small" themeColor="textSecondary">
                Reading the grant PDF…
              </ThemedText>
            </View>
          )}
          {extractError && (
            <ThemedText type="small" themeColor="negative">
              {extractError}
            </ThemedText>
          )}
          {extraction && (
            <View style={styles.stack}>
              <ThemedText type="small">
                Filled in{extraction.filename ? ` from ${extraction.filename}` : ''}. Review every date and share count before saving.
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
        title="Grant document"
        subtitle="Keep a copy of the grant notice encrypted on this computer. Attaching doesn’t send it anywhere."
        action={
          <View style={styles.inline}>
            {document && <Button label="Remove" variant="secondary" size="small" disabled={busy} onPress={() => choose(null)} />}
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
            manual="Enter your grant details and generate your vesting schedule below."
            aiDoes="read a grant PDF or pasted vesting table for you"
          />
        )}
        {(uploadError || docError) && (
          <ThemedText type="small" themeColor="negative">
            {uploadError ?? docError}
          </ThemedText>
        )}
      </Card>

      <EquityForm
        key={extraction ? `extracted-${extractionKey}` : (existing?.id ?? 'new')}
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
  inline: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  stack: { gap: Spacing.two },
  pasteInput: { minHeight: 110, textAlignVertical: 'top' },
});
