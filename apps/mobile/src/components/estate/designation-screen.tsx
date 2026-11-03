import {
  ESTATE_METHOD_LABELS,
  isTrust,
  methodNamesPeople,
  type EstateCategory,
  type EstateMethod,
  type EstateTarget,
} from '@meld/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { BeneficiariesEditor, parseBeneficiaries, toBeneficiaryDrafts } from '@/components/beneficiaries-editor';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Chip } from '@/components/chip';
import { Field, formStyles, Input, parseDate } from '@/components/form-fields';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { formatWholeCurrency } from '@/lib/format';
import { useEstate, useSaveDesignation } from '@/lib/queries';

const goBack = () => (router.canGoBack() ? router.back() : router.replace('/plan?tab=estate'));
const today = () => new Date().toLocaleDateString('en-CA');

const METHODS: Record<EstateCategory, EstateMethod[]> = {
  retirement: ['beneficiary', 'trust', 'none'],
  hsa: ['beneficiary', 'trust', 'none'],
  education: ['beneficiary', 'trust', 'none'],
  custodial: ['none'],
  taxable: ['tod_pod', 'joint_survivorship', 'trust', 'will', 'none'],
  bank: ['tod_pod', 'joint_survivorship', 'trust', 'will', 'none'],
  property: ['tod_pod', 'joint_survivorship', 'trust', 'will', 'none'],
  vehicle: ['tod_pod', 'joint_survivorship', 'trust', 'will', 'none'],
  other: ['tod_pod', 'joint_survivorship', 'trust', 'will', 'none'],
  life: ['beneficiary', 'none'],
  debt: ['none'],
};

const HINTS: Partial<Record<EstateCategory, string>> = {
  retirement:
    'The beneficiary form on file with the plan or custodian decides who inherits, whatever your will says. Check it on their website, then record it here.',
  hsa: 'A spouse named as beneficiary keeps it as their own HSA; anyone else receives it as taxable income.',
  education: 'Name a successor owner with the plan so the account doesn’t go through probate. The student beneficiary stays the same.',
  bank: 'Most banks let you add a payable-on-death (POD) beneficiary online or with a short form.',
  taxable: 'Most brokerages let you add a transfer-on-death (TOD) beneficiary online.',
  property: 'Real estate usually passes by your trust, joint title with survivorship, or a transfer-on-death deed where your state allows one.',
  custodial: 'A custodial account already belongs to the child. Name a successor custodian with the institution.',
  debt: 'Debts are paid from your estate before anything is distributed. Nothing to set up; it’s listed in the packet.',
};

const methodLabel = (m: EstateMethod, category: EstateCategory) =>
  m === 'beneficiary' && category === 'education'
    ? 'Successor owner'
    : m === 'tod_pod' && category === 'property'
      ? 'Transfer-on-death deed'
      : ESTATE_METHOD_LABELS[m];

/** Records how an account or manual asset passes on death. */
export function DesignationScreen({ id }: { id: string }) {
  const estate = useEstate();
  const target = estate.data?.targets.find((t) => t.id === id);
  const back = (
    <Pressable onPress={goBack}>
      <ThemedText type="linkPrimary">‹ Back</ThemedText>
    </Pressable>
  );
  if (!target) {
    return (
      <Screen title="On death" actions={back}>
        <ThemedText themeColor={estate.isError ? 'negative' : 'textSecondary'}>
          {estate.isPending ? 'Loading…' : estate.isError ? estate.error.message : 'This account isn’t in your totals, so it isn’t listed.'}
        </ThemedText>
      </Screen>
    );
  }
  return (
    <Screen title={target.name} actions={back}>
      <DesignationForm target={target} trusts={estate.data!.documents.filter((d) => isTrust(d.kind))} />
    </Screen>
  );
}

function DesignationForm({ target: t, trusts }: { target: EstateTarget; trusts: { id: string; name: string }[] }) {
  const save = useSaveDesignation();
  const methods = METHODS[t.category];
  const [method, setMethod] = useState<EstateMethod>(methods.includes(t.method) ? t.method : methods[0]!);
  const [beneficiaries, setBeneficiaries] = useState(toBeneficiaryDrafts(t.beneficiaries));
  const [trustId, setTrustId] = useState(t.trustId ?? trusts[0]?.id ?? null);
  const [notes, setNotes] = useState(t.notes ?? '');
  const [reviewedAt, setReviewedAt] = useState(t.reviewedAt ?? '');

  const people = methodNamesPeople(method);
  const parsed = parseBeneficiaries(beneficiaries);
  const reviewed = parseDate(reviewedAt);
  const valid = (!people || parsed.every(Boolean)) && (method !== 'trust' || trustId !== null) && reviewed !== undefined;

  function submit() {
    if (!valid) return;
    save.mutate(
      {
        accountId: t.kind === 'account' ? t.id : null,
        manualAssetId: t.kind === 'asset' ? t.id : null,
        method,
        beneficiaries: people ? parsed.filter((b) => b !== null) : [],
        trustId: method === 'trust' ? trustId : null,
        reviewedAt: reviewed ?? null,
        notes: notes.trim() || null,
      },
      { onSuccess: goBack },
    );
  }

  return (
    <>
      <Card>
        <ThemedText type="small" themeColor="textSecondary">
          {[t.detail, t.value !== null && formatWholeCurrency(t.value)].filter(Boolean).join(' · ')}
        </ThemedText>
        {HINTS[t.category] && <ThemedText type="small">{HINTS[t.category]}</ThemedText>}
      </Card>

      {methods.length > 1 && (
        <Card title="How it passes">
          <View style={formStyles.chips}>
            {methods.map((m) => (
              <Chip key={m} label={methodLabel(m, t.category)} selected={method === m} onPress={() => setMethod(m)} />
            ))}
          </View>
          {method === 'trust' &&
            (trusts.length ? (
              <View style={formStyles.chips}>
                {trusts.map((tr) => (
                  <Chip key={tr.id} label={tr.name} selected={trustId === tr.id} onPress={() => setTrustId(tr.id)} />
                ))}
              </View>
            ) : (
              <ThemedText type="small" themeColor="warning">
                Add your trust under Plan → Estate → Documents first.
              </ThemedText>
            ))}
          {method === 'joint_survivorship' && (
            <ThemedText type="small" themeColor="textSecondary">
              It passes to the surviving owner. Once they inherit it, their own beneficiaries decide what happens next.
            </ThemedText>
          )}
          {method === 'will' && (
            <ThemedText type="small" themeColor="textSecondary">
              It goes through probate, which is public and can take months.
            </ThemedText>
          )}
        </Card>
      )}

      {people && (
        <BeneficiariesEditor
          value={beneficiaries}
          onChange={setBeneficiaries}
          title={t.category === 'education' ? 'Successor owner' : 'Beneficiaries'}
          subtitle="As the institution has them on file. Contingent beneficiaries inherit if no primary beneficiary survives you."
        />
      )}

      <Card title="Notes">
        <Input value={notes} onChangeText={setNotes} placeholder="Estate services phone number, where the form is, anything your executor should know…" multiline />
        <Field label="Last checked with the institution" invalid={reviewed === undefined}>
          <View style={formStyles.buttons}>
            <Input value={reviewedAt} onChangeText={setReviewedAt} placeholder="YYYY-MM-DD" style={{ width: 140 }} />
            <Button label="Today" variant="secondary" size="small" onPress={() => setReviewedAt(today())} />
          </View>
        </Field>
      </Card>

      {save.isError && <ThemedText themeColor="negative">{save.error.message}</ThemedText>}
      <View style={formStyles.buttons}>
        <Button label="Save" disabled={!valid} loading={save.isPending} onPress={submit} />
        <Button label="Cancel" variant="secondary" onPress={goBack} />
      </View>
    </>
  );
}
