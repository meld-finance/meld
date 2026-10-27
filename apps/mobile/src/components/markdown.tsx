import { Fragment } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Renders the Markdown subset the AI is asked to use: paragraphs, ### headings,
 * bullet and numbered lists, tables, **bold**, *italic* and `code`.
 * Anything else shows as plain text, so partial text mid-stream renders sensibly.
 */
type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'table'; header: string[]; rows: string[][] };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-{2,}/;

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r/g, '').split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: 'heading', text: heading[1]! });
      continue;
    }
    if (TABLE_ROW.test(line) && TABLE_DIVIDER.test(lines[i + 1] ?? '')) {
      flush();
      const header = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && TABLE_ROW.test(lines[i]!)) rows.push(cells(lines[i++]!));
      i--;
      blocks.push({ kind: 'table', header, rows });
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      flush();
      const ordered = !!numbered;
      const item = (bullet ?? numbered)![1]!;
      const last = blocks.at(-1);
      if (last?.kind === 'list' && last.ordered === ordered) last.items.push(item);
      else blocks.push({ kind: 'list', ordered, items: [item] });
      continue;
    }
    // A wrapped line continues the previous list item.
    const last = blocks.at(-1);
    if (!paragraph.length && last?.kind === 'list' && /^\s{2,}/.test(line)) {
      last.items[last.items.length - 1] += ` ${line.trim()}`;
      continue;
    }
    paragraph.push(line.trim());
  }
  flush();
  return blocks;
}

function Inline({ text }: { text: string }) {
  const theme = useTheme();
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g).filter(Boolean);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
          return <Text key={i} style={styles.bold}>{part.slice(2, -2)}</Text>;
        }
        if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
          return (
            <Text key={i} style={[styles.code, { backgroundColor: theme.backgroundSelected }]}>
              {part.slice(1, -1)}
            </Text>
          );
        }
        if ((part.startsWith('*') && part.endsWith('*')) || (part.startsWith('_') && part.endsWith('_'))) {
          if (part.length > 2) return <Text key={i} style={styles.italic}>{part.slice(1, -1)}</Text>;
        }
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </>
  );
}

function Table({ header, rows }: { header: string[]; rows: string[][] }) {
  const theme = useTheme();
  const columns = header.length;
  const renderRow = (row: string[], i: number, head = false) => (
    <View key={i} style={[styles.tableRow, { borderColor: theme.border }]}>
      {Array.from({ length: columns }, (_, c) => (
        <View key={c} style={styles.cell}>
          <ThemedText type="small" style={head && styles.bold}>
            <Inline text={row[c] ?? ''} />
          </ThemedText>
        </View>
      ))}
    </View>
  );
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tableScroll}>
      <View style={styles.table}>
        {renderRow(header, -1, true)}
        {rows.map((r, i) => renderRow(r, i))}
      </View>
    </ScrollView>
  );
}

export function Markdown({ text }: { text: string }) {
  return (
    <View style={styles.root}>
      {parseMarkdown(text).map((block, i) => {
        switch (block.kind) {
          case 'heading':
            return (
              <ThemedText key={i} type="smallBold" style={styles.heading}>
                <Inline text={block.text} />
              </ThemedText>
            );
          case 'paragraph':
            return (
              <ThemedText key={i}>
                <Inline text={block.text} />
              </ThemedText>
            );
          case 'list':
            return (
              <View key={i} style={styles.list}>
                {block.items.map((item, j) => (
                  <View key={j} style={styles.listItem}>
                    <ThemedText style={styles.marker}>{block.ordered ? `${j + 1}.` : '•'}</ThemedText>
                    <ThemedText style={styles.shrink}>
                      <Inline text={item} />
                    </ThemedText>
                  </View>
                ))}
              </View>
            );
          case 'table':
            return <Table key={i} header={block.header} rows={block.rows} />;
        }
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: Spacing.two },
  heading: { marginTop: Spacing.one },
  bold: { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  code: { fontFamily: Fonts?.mono, borderRadius: 4, paddingHorizontal: 3 },
  list: { gap: Spacing.one },
  listItem: { flexDirection: 'row', gap: Spacing.two },
  marker: { minWidth: 16 },
  shrink: { flexShrink: 1 },
  tableScroll: { flexGrow: 0 },
  table: { minWidth: '100%' },
  tableRow: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  cell: { minWidth: 96, flex: 1, paddingVertical: Spacing.one, paddingRight: Spacing.three },
});
