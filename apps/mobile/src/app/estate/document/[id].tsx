import {
  DOCUMENT_ROLES,
  ESTATE_DOCUMENT_LABELS,
  ESTATE_ROLE_LABELS,
  EstateDocumentKind,
  type EstateDocument,
  type EstateDocumentInput,
  type EstateRole,
} from '@meld/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Chip } from '@/components/chip';
import { Field, formStyles, Input, parseDate, Row } from '@/components/form-fields';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { confirm } from '@/lib/confirm';
import { openDocument } from '@/lib/documents';
import { pickPdf } from '@/lib/pick-pdf';
import { discardDocument, useDeleteEstateDocument, useEstateDocument, useSaveEstateDocument, useUploadDocument } from '@/lib/queries';

const goBack = () => (router.canGoBack() ? router.back() : router.replace('/plan?tab=estate'));
const today = () => new Date().toLocaleDateString('en-CA');
const text = (s: string) => s.trim() || null;

type PersonDraft = { role: EstateRole; name: string; relationship: string; phone: string; email: string };
type Doc = { id: string; filename: string };

export default function EstateDocumentScreen() {
  const { id, kind } = useLocalSearchParams<{ id: string; kind?: string }>();
  const isNew = id === 'new';
  const existing = useEstateDocument(isNew ? undefined : id);
  const back = (
    <Pressable onPress={goBack}>
      <ThemedText type="linkPrimary">‹ Estate</ThemedText>
    </Pressable>
  );
  if (!isNew && !existing.data) {
    return (
      <Screen title="Document" actions={back}>
        <ThemedText themeColor={existing.isError ? 'negative' : 'textSecondary'}>
          {existing.isError ? `Couldn’t load this document: ${existing.error.message}` : 'Loading…'}
        </ThemedText>
      </Screen>
    );
  }
  const initialKind = EstateDocumentKind.safeParse(kind).data ?? 'revocable_trust';
  return (
    <Screen title={existing.data?.name ?? 'Add document'} actions={back}>
      <DocumentForm initial={existing.data ?? null} initialKind={initialKind} />
    </Screen>
  );
}

function DocumentForm({ initial, initialKind }: { initial: EstateDocument | null; initialKind: EstateDocumentKind }) {
  const theme = useTheme();
  const save = useSaveEstateDocument();
  const remove = useDeleteEstateDocument();
  const attach = useUploadDocument();
  const [kind, setKind] = useState<EstateDocumentKind>(initial?.kind ?? initialKind);
  const [name, setName] = useState(initial?.name ?? '');
  const [signedDate, setSignedDate] = useState(initial?.signedDate ?? '');
  const [state, setState] = useState(initial?.state ?? '');
  const [reviewedAt, setReviewedAt] = useState(initial?.reviewedAt ?? '');
  const [location, setLocation] = useState(initial?.originalLocation ?? '');
  const [people, setPeople] = useState<PersonDraft[]>(
    (initial?.people ?? []).map((p) => ({ ...p, relationship: p.relationship ?? '', phone: p.phone ?? '', email: p.email ?? '' })),
  );
  const [attorney, setAttorney] = useState({
    name: initial?.attorney?.name ?? '',
    phone: initial?.attorney?.phone ?? '',
    email: initial?.attorney?.email ?? '',
  });
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const savedDoc: Doc | null = initial?.documentId ? { id: initial.documentId, filename: initial.documentFilename ?? 'Document' } : null;
  const [document, setDocument] = useState<Doc | null>(savedDoc);
  // Uploads made on this screen; any not saved with the document are discarded.
  const uploads = useRef<string[]>([]);
  const [docError, setDocError] = useState<string | null>(null);

  const roles = [...DOCUMENT_ROLES[kind], ...(DOCUMENT_ROLES[kind].includes('other') ? [] : (['other'] as const))];
  const dates = { signedDate: parseDate(signedDate), reviewedAt: parseDate(reviewedAt) };
  const badState = !!state.trim() && !/^[A-Za-z]{2}$/.test(state.trim());
  const valid =
    dates.signedDate !== undefined && dates.reviewedAt !== undefined && !badState && people.every((p) => p.name.trim());
  const title = name.trim() || ESTATE_DOCUMENT_LABELS[kind];

  const updatePerson = (i: number, patch: Partial<PersonDraft>) => setPeople((list) => list.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  function discardUploads(keep?: string | null) {
    const drop = uploads.current.filter((u) => u !== keep);
    uploads.current = uploads.current.filter((u) => u === keep);
    return Promise.all(drop.map(discardDocument));
  }

  async function cancel() {
    await discardUploads();
    goBack();
  }

  async function attachPdf() {
    const picked = await pickPdf();
    if (!picked) return;
    attach.mutate(picked.form, {
      onSuccess: (d) => {
        uploads.current.push(d.documentId);
        setDocument({ id: d.documentId, filename: d.filename });
      },
    });
  }

  function submit() {
    if (!valid) return;
    const input: EstateDocumentInput = {
      kind,
      name: title,
      signedDate: dates.signedDate ?? null,
      state: text(state)?.toUpperCase() ?? null,
      reviewedAt: dates.reviewedAt ?? null,
      originalLocation: text(location),
      people: people.map((p) => ({ role: p.role, name: p.name.trim(), relationship: text(p.relationship), phone: text(p.phone), email: text(p.email) })),
      attorney: attorney.name.trim() ? { name: attorney.name.trim(), relationship: null, phone: text(attorney.phone), email: text(attorney.email) } : null,
      documentId: document?.id ?? null,
      notes: text(notes),
    };
    save.mutate(
      { id: initial?.id, input },
      {
        onSuccess: () => {
          void discardUploads(input.documentId);
          goBack();
        },
      },
    );
  }

  async function onDelete() {
    if (!initial) return;
    const ok = await confirm(
      `Delete ${initial.name}?`,
      `${initial.documentId ? 'Its scanned copy is deleted too. ' : ''}Accounts titled to it will show as not set up. This doesn’t affect the signed original.`,
      'Delete',
    );
    if (ok) remove.mutate(initial.id, { onSuccess: goBack });
  }

  return (
    <>
      <Card title="Document">
        <Field label="Type">
          <View style={formStyles.chips}>
            {EstateDocumentKind.options.map((k) => (
              <Chip key={k} label={ESTATE_DOCUMENT_LABELS[k]} selected={kind === k} onPress={() => setKind(k)} />
            ))}
          </View>
        </Field>
        <Field label="Name">
          <Input value={name} onChangeText={setName} placeholder={ESTATE_DOCUMENT_LABELS[kind]} />
        </Field>
        <Row>
          <Field label="Signed" invalid={dates.signedDate === undefined} flex>
            <Input value={signedDate} onChangeText={setSignedDate} placeholder="YYYY-MM-DD" />
          </Field>
          <Field label="State" invalid={badState} flex>
            <Input value={state} onChangeText={setState} placeholder="e.g. CA" maxLength={2} autoCapitalize="characters" />
          </Field>
        </Row>
        <Field label="Last read through and still right" invalid={dates.reviewedAt === undefined}>
          <View style={formStyles.buttons}>
            <Input value={reviewedAt} onChangeText={setReviewedAt} placeholder="YYYY-MM-DD" style={styles.date} />
            <Button label="Today" variant="secondary" size="small" onPress={() => setReviewedAt(today())} />
          </View>
        </Field>
        <Field label="Where the signed original is kept">
          <Input value={location} onChangeText={setLocation} placeholder="e.g. Fireproof safe in the hall closet, or with the attorney" />
        </Field>
      </Card>

      <Card
        title="People it names"
        subtitle="With phone numbers, so your family can reach them. They're printed in the packet."
        action={
          <Button
            label="Add"
            variant="secondary"
            size="small"
            onPress={() => setPeople((list) => [...list, { role: roles[Math.min(list.length, roles.length - 1)]!, name: '', relationship: '', phone: '', email: '' }])}
          />
        }>
        {people.length === 0 && (
          <ThemedText type="small" themeColor="textSecondary">
            {`E.g. the ${DOCUMENT_ROLES[kind].map((r) => ESTATE_ROLE_LABELS[r].toLowerCase()).join(' and ')}.`}
          </ThemedText>
        )}
        {people.map((p, i) => (
          <View key={i} style={[styles.person, { borderColor: theme.border }]}>
            <View style={formStyles.chips}>
              {roles.map((r) => (
                <Chip key={r} label={ESTATE_ROLE_LABELS[r]} selected={p.role === r} onPress={() => updatePerson(i, { role: r })} />
              ))}
            </View>
            <Row>
              <Field label="Name" invalid={!p.name.trim()} flex>
                <Input value={p.name} onChangeText={(v) => updatePerson(i, { name: v })} />
              </Field>
              <Field label="Relationship" flex>
                <Input value={p.relationship} onChangeText={(v) => updatePerson(i, { relationship: v })} />
              </Field>
            </Row>
            <Row>
              <Field label="Phone" flex>
                <Input value={p.phone} onChangeText={(v) => updatePerson(i, { phone: v })} inputMode="tel" />
              </Field>
              <Field label="Email" flex>
                <Input value={p.email} onChangeText={(v) => updatePerson(i, { email: v })} inputMode="email" autoCapitalize="none" />
              </Field>
            </Row>
            <View style={formStyles.buttons}>
              <View style={formStyles.spacer} />
              <Button label="Remove" variant="secondary" size="small" onPress={() => setPeople((list) => list.filter((_, j) => j !== i))} />
            </View>
          </View>
        ))}
      </Card>

      <Card title="Attorney">
        <Row>
          <Field label="Name or firm" flex>
            <Input value={attorney.name} onChangeText={(v) => setAttorney((a) => ({ ...a, name: v }))} />
          </Field>
          <Field label="Phone" flex>
            <Input value={attorney.phone} onChangeText={(v) => setAttorney((a) => ({ ...a, phone: v }))} inputMode="tel" />
          </Field>
          <Field label="Email" flex>
            <Input value={attorney.email} onChangeText={(v) => setAttorney((a) => ({ ...a, email: v }))} inputMode="email" autoCapitalize="none" />
          </Field>
        </Row>
      </Card>

      <Card
        title="Scanned copy"
        subtitle="Kept encrypted on this computer, for reference. It isn’t sent anywhere, and isn’t a substitute for the signed original."
        action={
          <View style={formStyles.buttons}>
            {document && <Button label="Remove" variant="secondary" size="small" onPress={() => setDocument(null)} />}
            <Button label={document ? 'Replace PDF' : 'Attach PDF'} variant="secondary" size="small" loading={attach.isPending} onPress={() => void attachPdf()} />
          </View>
        }>
        {document ? (
          <Pressable onPress={() => openDocument(document.id, document.filename).catch((err: Error) => setDocError(err.message))}>
            <ThemedText type="linkPrimary">View {document.filename} ↗</ThemedText>
          </Pressable>
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            {savedDoc ? `${savedDoc.filename} will be removed when you save.` : 'No copy attached.'}
          </ThemedText>
        )}
        {(attach.error || docError) && (
          <ThemedText type="small" themeColor="negative">
            {attach.error?.message ?? docError}
          </ThemedText>
        )}
      </Card>

      <Card title="Notes">
        <Input value={notes} onChangeText={setNotes} placeholder="Amendments, what it covers, anything your family should know…" multiline />
      </Card>

      {(save.error || remove.error) && <ThemedText themeColor="negative">{(save.error ?? remove.error)!.message}</ThemedText>}
      {!valid && (
        <ThemedText type="small" themeColor="textSecondary">
          Fix the highlighted fields to save.
        </ThemedText>
      )}
      <View style={formStyles.buttons}>
        <Button label="Save" disabled={!valid} loading={save.isPending} onPress={submit} />
        <Button label="Cancel" variant="secondary" onPress={() => void cancel()} />
        <View style={formStyles.spacer} />
        {initial && <Button label="Delete" variant="danger" loading={remove.isPending} onPress={() => void onDelete()} />}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  date: { width: 140 },
  person: { gap: Spacing.two, paddingBottom: Spacing.three, borderBottomWidth: StyleSheet.hairlineWidth },
});
