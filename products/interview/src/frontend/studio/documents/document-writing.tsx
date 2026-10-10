"use client";

import {
  Flex,
  List,
  ListItem,
  Panel,
  Progress,
  Typography,
} from "@oc-tech/omni-ui-components";
import type { DocumentField } from "@omnitech/interview-contracts";
import { Icon } from "../icon";
import { DocumentPreview, type PreviewPayload } from "./document-preview";

export type WritingBatch = {
  id: string;
  title: string;
  count: number;
  done: boolean;
};

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

// Up to this many sections are written at once; the rest wait their turn.
const WRITING_AT_ONCE = 4;

/**
 * A document being written: the sections on one side, ticking off as each is
 * done, and the document itself on the other, filling in as they land.
 */
export function WritingView({
  title,
  model,
  batches,
  fields,
  preview,
  seconds,
  finished,
}: {
  title: string;
  model: string;
  batches: readonly WritingBatch[] | null;
  fields: readonly DocumentField[];
  preview: PreviewPayload | null;
  seconds: number;
  finished: boolean;
}) {
  const done = batches?.filter((batch) => batch.done).length ?? 0;
  const total = batches?.length ?? 0;
  // The first not-yet-done sections are the ones being written right now.
  const writingNow = new Set(
    (batches ?? [])
      .filter((batch) => !batch.done)
      .slice(0, WRITING_AT_ONCE)
      .map((batch) => batch.id),
  );
  const percent = finished ? 100 : total ? Math.round((done / total) * 100) : 4;
  return (
    <Flex gap={16} style={{ height: "100%", minHeight: 0, padding: 16 }}>
      <Panel title="Progress" width={340} bodyPadding="md">
        <Flex vertical gap={12}>
          <Flex align="center" gap={12}>
            <Icon name={finished ? "check_circle" : "auto_awesome"} size={20} />
            <Flex vertical>
              <Typography.Text>
                {finished ? "Done. Opening it…" : "Writing your document"}
              </Typography.Text>
              <Typography.Text type="secondary" size="compact">
                {title}
              </Typography.Text>
            </Flex>
          </Flex>
          <Progress
            percent={percent}
            showInfo={false}
            aria-label="Sections written"
          />
          <Flex justify="space-between">
            <Typography.Text size="compact">
              {total
                ? `${done} of ${total} sections`
                : "Reading your experience…"}
            </Typography.Text>
            <Typography.Text size="compact">{clock(seconds)}</Typography.Text>
          </Flex>
          <List>
            {(batches ?? []).map((batch) => (
              <ListItem key={batch.id}>
                <Flex align="center" gap={8}>
                  {batch.done ? (
                    <Icon name="check_circle" size={18} />
                  ) : writingNow.has(batch.id) ? (
                    <Progress shape="ring" size={18} aria-hidden />
                  ) : (
                    <Icon name="radio_button_unchecked" size={18} />
                  )}
                  <Typography.Text style={{ flex: 1 }}>
                    {batch.title}
                  </Typography.Text>
                  <Typography.Text type="secondary" size="compact">
                    {batch.count}
                  </Typography.Text>
                </Flex>
              </ListItem>
            ))}
          </List>
          <Typography.Paragraph type="secondary" size="compact">
            {model} writes the sections side by side. Everything is editable
            once it’s done, and each change is kept as a revision.
          </Typography.Paragraph>
        </Flex>
      </Panel>
      <Flex style={{ flex: "1 1 0", minWidth: 0, minHeight: 0 }}>
        <DocumentPreview
          preview={preview}
          fields={fields}
          selected={null}
          onSelect={() => undefined}
          writing={!finished}
        />
      </Flex>
    </Flex>
  );
}
