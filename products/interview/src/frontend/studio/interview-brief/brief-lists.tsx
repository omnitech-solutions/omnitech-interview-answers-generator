// The two lists of an interview brief a person keeps by hand: what the
// employer said (dated entries) and the research documents. Each is a list of
// rows with its own remove (confirmed in place) and a small form that adds
// one. They hold no data of their own: the Interview form backs them with the
// server, the Briefings form with the pack's own setup. Library parts only.
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  FileUpload,
  Flex,
  FormActions,
  Input,
  Popconfirm,
  Tag,
  Textarea,
  Typography,
} from "@oc-tech/omni-ui-components";
import { DynamicForm } from "@oc-tech/omni-ui-components/dynamic-form";
import {
  type EmployerSaidInput,
  employerSaidLine,
  INTERVIEW_BRIEF_BOUNDS,
} from "@omnitech/interview-contracts";
import { type ReactNode, useState } from "react";
import { z } from "zod";
import { formParser } from "../shared/contract-form";
import {
  employerSaidFormSchema,
  employerSaidUiSchema,
  emptyEmployerSaid,
  toEmployerSaidInput,
} from "./employer-said-form";

// The form holds an empty text where the contract has an absent field, so its
// own gate takes any record; `toEmployerSaidInput` is the contract's reading.
const SAID_PARSER = formParser(z.record(z.string(), z.unknown()));
const EMPTY_SAID = emptyEmployerSaid();

export type SaidRow = EmployerSaidInput & { id: string };

// One row: what it is, then what can be done with it.
function Row({
  children,
  actions,
  testId,
}: {
  children: ReactNode;
  actions: ReactNode;
  testId: string;
}) {
  return (
    <Flex gap={8} align="start" justify="space-between" data-testid={testId}>
      <Flex vertical gap={4}>
        {children}
      </Flex>
      <Flex gap={4} align="center">
        {actions}
      </Flex>
    </Flex>
  );
}

function Remove({
  what,
  onConfirm,
  disabled,
  testId,
}: {
  what: string;
  onConfirm(): void;
  disabled: boolean;
  testId: string;
}) {
  return (
    <Popconfirm
      title={`Remove ${what}?`}
      description="It is deleted from this interview. This cannot be undone."
      confirmText="Remove"
      cancelText="Keep"
      onConfirm={onConfirm}
    >
      <Button
        buttonSize="sm"
        variant="ghost"
        disabled={disabled}
        data-testid={testId}
      >
        Remove
      </Button>
    </Popconfirm>
  );
}

export function EmployerSaidList({
  entries,
  disabled = false,
  onAdd,
  onRemove,
}: {
  entries: readonly SaidRow[];
  disabled?: boolean;
  onAdd(entry: EmployerSaidInput): void;
  onRemove(id: string): void;
}) {
  // What the form holds decides whether Add can be pressed; a count remounts
  // the form empty once an entry is added.
  const [draft, setDraft] = useState(emptyEmployerSaid);
  const [added, setAdded] = useState(0);
  const add = (values: unknown) => {
    const entry = toEmployerSaidInput(values);
    if (!entry) return;
    onAdd(entry);
    setDraft(emptyEmployerSaid());
    setAdded((count) => count + 1);
  };
  return (
    <Card data-testid="ib-said">
      <CardHeader>
        <CardTitle>Employer said</CardTitle>
        <Typography.Text type="secondary">
          What the employer or a recruiter told you, in their words: an email, a
          call, a message. Each with who said it and when.
        </Typography.Text>
      </CardHeader>
      <CardContent>
        <Flex vertical gap={12}>
          {entries.length === 0 && (
            <Typography.Text type="secondary">
              Nothing the employer said yet
            </Typography.Text>
          )}
          {entries.map((entry) => (
            <Row
              key={entry.id}
              testId="ib-said-row"
              actions={
                <Remove
                  what="this entry"
                  disabled={disabled}
                  onConfirm={() => onRemove(entry.id)}
                  testId="ib-said-remove"
                />
              }
            >
              <Typography.Text>{employerSaidLine(entry)}</Typography.Text>
              {!entry.saidOn && <Tag>No date</Tag>}
            </Row>
          ))}
          <DynamicForm
            key={added}
            schema={employerSaidFormSchema}
            uiSchema={employerSaidUiSchema}
            zodSchema={SAID_PARSER}
            formData={EMPTY_SAID}
            disabled={disabled}
            onChange={setDraft}
            onSubmit={add}
          >
            <FormActions divider={false} align="start">
              <Button
                type="submit"
                buttonSize="sm"
                variant="outline"
                disabled={disabled || toEmployerSaidInput(draft) === null}
                data-testid="ib-said-add"
              >
                Add entry
              </Button>
            </FormActions>
          </DynamicForm>
        </Flex>
      </CardContent>
    </Card>
  );
}

export type ResearchRow = {
  id: string;
  title: string;
  // Where it came from, as a few words ("pasted", a file's name, a URL).
  from: string;
  chars: number;
  // The company's old single research text, not yet kept as a document.
  carried?: boolean;
};

export function ResearchList({
  documents,
  disabled = false,
  onAdd,
  onUpload,
  onKeep,
  onRemove,
}: {
  documents: readonly ResearchRow[];
  disabled?: boolean;
  onAdd(document: { title: string; text: string; originRef?: string }): void;
  // Absent: only pasted text and a link's text are taken here.
  onUpload?: (file: File) => void;
  onKeep?: () => void;
  onRemove(id: string): void;
}) {
  const [title, setTitle] = useState("");
  const [link, setLink] = useState("");
  const [text, setText] = useState("");
  const add = () => {
    onAdd({
      title: title.trim(),
      text,
      ...(link.trim() ? { originRef: link.trim() } : {}),
    });
    setTitle("");
    setLink("");
    setText("");
  };
  return (
    <Card data-testid="ib-research">
      <CardHeader>
        <CardTitle>Research</CardTitle>
        <Typography.Text type="secondary">
          What you found out yourself: the company, the interviewers, what other
          candidates report. Paste a page, the text of a link, or upload a text
          file.
        </Typography.Text>
      </CardHeader>
      <CardContent>
        <Flex vertical gap={12}>
          {documents.length === 0 && (
            <Typography.Text type="secondary">No research yet</Typography.Text>
          )}
          {documents.map((document) => (
            <Row
              key={document.id}
              testId="ib-research-row"
              actions={
                document.carried ? (
                  onKeep && (
                    <Button
                      buttonSize="sm"
                      variant="outline"
                      disabled={disabled}
                      onClick={onKeep}
                      data-testid="ib-research-keep"
                    >
                      Keep as a document
                    </Button>
                  )
                ) : (
                  <Remove
                    what={`"${document.title}"`}
                    disabled={disabled}
                    onConfirm={() => onRemove(document.id)}
                    testId="ib-research-remove"
                  />
                )
              }
            >
              <Typography.Text>{document.title}</Typography.Text>
              <Flex gap={4} wrap="wrap">
                <Tag>{document.from}</Tag>
                <Tag>{document.chars.toLocaleString("en-US")} characters</Tag>
                {document.carried && <Tag>Carried over</Tag>}
              </Flex>
            </Row>
          ))}
          <Flex gap={8} wrap="wrap">
            <Input
              label="Title"
              value={title}
              onChange={setTitle}
              disabled={disabled}
              data-testid="ib-research-title"
            />
            <Input
              label="Link it came from (optional)"
              type="url"
              value={link}
              onChange={setLink}
              disabled={disabled}
              data-testid="ib-research-link"
            />
          </Flex>
          <Textarea
            label="Text"
            rows={4}
            value={text}
            onChange={setText}
            disabled={disabled}
            data-testid="ib-research-text"
          />
          <Flex gap={8} align="end" wrap="wrap">
            <Button
              buttonSize="sm"
              variant="outline"
              disabled={disabled || title.trim() === "" || text.trim() === ""}
              onClick={add}
              data-testid="ib-research-add"
            >
              Add research
            </Button>
            {onUpload && (
              <FileUpload
                label="Or upload a text file (.txt, .md)"
                accept=".txt,.md,.markdown,text/plain,text/markdown"
                maxSize={INTERVIEW_BRIEF_BOUNDS.researchUploadBytes}
                value={null}
                disabled={disabled}
                onChange={(files) => {
                  const [file] = files;
                  if (file) onUpload(file);
                }}
                data-testid="ib-research-upload"
              />
            )}
          </Flex>
        </Flex>
      </CardContent>
    </Card>
  );
}
