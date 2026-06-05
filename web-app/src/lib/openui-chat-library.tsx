import { Button as JanButton } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  FormNameContext,
  createLibrary,
  defineComponent,
  reactive,
  tagSchemaId,
  useFormName,
  useIsStreaming,
  useStateField,
  useTriggerAction,
} from '@openuidev/react-lang'
import { z } from 'zod/v4'

const actionSchema = z.any()
tagSchemaId(actionSchema, 'ActionExpression')

const TextContent = defineComponent({
  name: 'TextContent',
  props: z.object({
    text: z.string(),
    size: z
      .enum(['small', 'default', 'large', 'small-heavy', 'large-heavy'])
      .optional(),
  }),
  description: 'Text content with an optional size and emphasis',
  component: ({ props }) => (
    <div
      className={cn(
        'text-sm text-foreground',
        props.size === 'small' && 'text-xs',
        props.size === 'large' && 'text-base',
        props.size === 'small-heavy' && 'text-xs font-semibold',
        props.size === 'large-heavy' && 'text-base font-semibold'
      )}
    >
      {props.text}
    </div>
  ),
})

const Callout = defineComponent({
  name: 'Callout',
  props: z.object({
    variant: z
      .enum(['info', 'warning', 'error', 'success', 'neutral'])
      .optional(),
    title: z.string(),
    description: z.string().optional(),
  }),
  description: 'A compact callout with a title and optional description',
  component: ({ props }) => (
    <div
      className={cn(
        'rounded-md border border-border bg-muted/40 p-3 text-sm',
        props.variant === 'error' && 'border-destructive/40',
        props.variant === 'success' && 'border-green-600/40',
        props.variant === 'warning' && 'border-yellow-600/40'
      )}
    >
      <div className="font-medium">{props.title}</div>
      {props.description && (
        <div className="mt-1 text-muted-foreground">{props.description}</div>
      )}
    </div>
  ),
})

const Separator = defineComponent({
  name: 'Separator',
  props: z.object({}),
  description: 'A horizontal separator',
  component: () => <hr className="border-border" />,
})

const Input = defineComponent({
  name: 'Input',
  props: z.object({
    name: z.string(),
    placeholder: z.string().optional(),
    type: z.enum(['text', 'email', 'password', 'number', 'url']).optional(),
    rules: z.object({}).passthrough().optional(),
    value: reactive(z.string().optional()),
  }),
  description: 'A single-line form input',
  component: function InputComponent({ props }) {
    const isStreaming = useIsStreaming()
    const field = useStateField(props.name, props.value)

    return (
      <input
        id={field.name}
        name={field.name}
        type={props.type ?? 'text'}
        value={field.value ?? ''}
        placeholder={props.placeholder}
        disabled={isStreaming}
        onChange={(event) => field.setValue(event.target.value)}
        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
      />
    )
  },
})

const TextArea = defineComponent({
  name: 'TextArea',
  props: z.object({
    name: z.string(),
    placeholder: z.string().optional(),
    rows: z.number().optional(),
    rules: z.object({}).passthrough().optional(),
    value: reactive(z.string().optional()),
  }),
  description: 'A multi-line form input',
  component: function TextAreaComponent({ props }) {
    const isStreaming = useIsStreaming()
    const field = useStateField(props.name, props.value)

    return (
      <textarea
        id={field.name}
        name={field.name}
        rows={props.rows ?? 3}
        value={field.value ?? ''}
        placeholder={props.placeholder}
        disabled={isStreaming}
        onChange={(event) => field.setValue(event.target.value)}
        className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
      />
    )
  },
})

const FormControl = defineComponent({
  name: 'FormControl',
  props: z.object({
    label: z.string(),
    input: z.union([Input.ref, TextArea.ref]),
    hint: z.string().optional(),
  }),
  description: 'A labeled form field with optional hint text',
  component: ({ props, renderNode }) => (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium">{props.label}</span>
      {renderNode(props.input)}
      {props.hint && (
        <span className="text-xs text-muted-foreground">{props.hint}</span>
      )}
    </label>
  ),
})

const Button = defineComponent({
  name: 'Button',
  props: z.object({
    label: z.string(),
    action: actionSchema.optional(),
    variant: z.enum(['primary', 'secondary', 'tertiary']).optional(),
    type: z.enum(['normal', 'destructive']).optional(),
  }),
  description: 'A clickable button that can send an action to the assistant',
  component: function ButtonComponent({ props }) {
    const triggerAction = useTriggerAction()
    const formName = useFormName()
    const isStreaming = useIsStreaming()

    return (
      <JanButton
        size="sm"
        variant={
          props.type === 'destructive'
            ? 'destructive'
            : props.variant === 'secondary'
              ? 'secondary'
              : props.variant === 'tertiary'
                ? 'ghost'
                : 'default'
        }
        disabled={isStreaming}
        onClick={() => triggerAction(props.label, formName, props.action)}
      >
        {props.label}
      </JanButton>
    )
  },
})

const Buttons = defineComponent({
  name: 'Buttons',
  props: z.object({
    buttons: z.array(Button.ref),
    direction: z.enum(['row', 'column']).optional(),
  }),
  description: 'A row or column of buttons',
  component: ({ props, renderNode }) => (
    <div
      className={cn(
        'flex flex-wrap gap-2',
        props.direction === 'column' && 'flex-col items-start'
      )}
    >
      {renderNode(props.buttons)}
    </div>
  ),
})

const Form = defineComponent({
  name: 'Form',
  props: z.object({
    name: z.string(),
    buttons: Buttons.ref,
    fields: z.array(FormControl.ref).default([]),
  }),
  description: 'A form with fields and explicit action buttons',
  component: ({ props, renderNode }) => (
    <FormNameContext.Provider value={props.name}>
      <div role="form" className="flex flex-col gap-3">
        {renderNode(props.fields)}
        {renderNode(props.buttons)}
      </div>
    </FormNameContext.Provider>
  ),
})

const FollowUpItem = defineComponent({
  name: 'FollowUpItem',
  props: z.object({ text: z.string() }),
  description: 'A clickable follow-up suggestion',
  component: () => null,
})

const FollowUpBlock = defineComponent({
  name: 'FollowUpBlock',
  props: z.object({ items: z.array(FollowUpItem.ref) }),
  description: 'A group of clickable follow-up suggestions',
  component: function FollowUpBlockComponent({ props }) {
    const triggerAction = useTriggerAction()
    const isStreaming = useIsStreaming()

    return (
      <div className="flex flex-wrap gap-2">
        {props.items.map((item, index) => {
          const text = String(item?.props?.text ?? '')
          return (
            <JanButton
              key={`${text}-${index}`}
              size="sm"
              variant="outline"
              disabled={isStreaming}
              onClick={() => triggerAction(text)}
            >
              {text}
            </JanButton>
          )
        })}
      </div>
    )
  },
})

const ListItem = defineComponent({
  name: 'ListItem',
  props: z.object({
    title: z.string(),
    subtitle: z.string().optional(),
    action: actionSchema.optional(),
  }),
  description: 'A list item with an optional action',
  component: () => null,
})

const ListBlock = defineComponent({
  name: 'ListBlock',
  props: z.object({ items: z.array(ListItem.ref) }),
  description: 'A vertical list of items',
  component: function ListBlockComponent({ props }) {
    const triggerAction = useTriggerAction()
    const isStreaming = useIsStreaming()

    return (
      <div className="flex flex-col gap-2">
        {props.items.map((item, index) => {
          const title = String(item?.props?.title ?? '')
          const subtitle = item?.props?.subtitle
            ? String(item.props.subtitle)
            : undefined
          const action = item?.props?.action

          return (
            <button
              key={`${title}-${index}`}
              type="button"
              disabled={isStreaming || !action}
              onClick={() => action && triggerAction(title, undefined, action)}
              className="rounded-md border border-border bg-background p-3 text-left disabled:cursor-default"
            >
              <div className="text-sm font-medium">{title}</div>
              {subtitle && (
                <div className="mt-1 text-xs text-muted-foreground">
                  {subtitle}
                </div>
              )}
            </button>
          )
        })}
      </div>
    )
  },
})

const Tag = defineComponent({
  name: 'Tag',
  props: z.object({ text: z.string() }),
  description: 'A compact text tag',
  component: ({ props }) => (
    <span className="rounded-full bg-secondary px-2 py-1 text-xs">
      {props.text}
    </span>
  ),
})

const TagBlock = defineComponent({
  name: 'TagBlock',
  props: z.object({ tags: z.array(z.union([z.string(), Tag.ref])) }),
  description: 'A group of tags',
  component: ({ props, renderNode }) => (
    <div className="flex flex-wrap gap-2">
      {props.tags.map((tag, index) =>
        typeof tag === 'string' ? (
          <span
            key={`${tag}-${index}`}
            className="rounded-full bg-secondary px-2 py-1 text-xs"
          >
            {tag}
          </span>
        ) : (
          <span key={index}>{renderNode(tag)}</span>
        )
      )}
    </div>
  ),
})

const Card = defineComponent({
  name: 'Card',
  props: z.object({
    children: z.array(
      z.union([
        TextContent.ref,
        Callout.ref,
        Separator.ref,
        Button.ref,
        Buttons.ref,
        Form.ref,
        FollowUpBlock.ref,
        ListBlock.ref,
        Tag.ref,
        TagBlock.ref,
      ])
    ),
  }),
  description: 'A vertical card containing chat UI elements',
  component: ({ props, renderNode }) => (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-background p-3">
      {renderNode(props.children)}
    </div>
  ),
})

export const janOpenUIChatPromptOptions = {
  additionalRules: [
    'Use Card as the root for multi-element responses.',
    'Use FollowUpBlock at the end of a Card for suggested next actions.',
    'Use Form with FormControl, Input or TextArea, and Buttons for user input.',
    'Use Action([@ToAssistant("message")]) on Buttons and actionable ListItems.',
  ],
  examples: [
    `root = Card([title, actions])
title = TextContent("What would you like to do?", "large-heavy")
actions = FollowUpBlock([first, second])
first = FollowUpItem("Summarize this")
second = FollowUpItem("Explain the tradeoffs")`,
    `root = Card([title, form])
title = TextContent("Contact details", "large-heavy")
form = Form("contact", buttons, [nameField])
nameField = FormControl("Name", Input("name", "Your name", "text"))
buttons = Buttons([Button("Submit", Action([@ToAssistant("Submit")]), "primary")])`,
  ],
}

export const janOpenUIChatLibrary = createLibrary({
  root: 'Card',
  componentGroups: [
    {
      name: 'Content',
      components: ['Card', 'TextContent', 'Callout', 'Separator'],
    },
    {
      name: 'Actions',
      components: [
        'Button',
        'Buttons',
        'FollowUpBlock',
        'FollowUpItem',
        'ListBlock',
        'ListItem',
      ],
    },
    {
      name: 'Forms',
      components: ['Form', 'FormControl', 'Input', 'TextArea'],
    },
    {
      name: 'Tags',
      components: ['Tag', 'TagBlock'],
    },
  ],
  components: [
    Card,
    TextContent,
    Callout,
    Separator,
    Button,
    Buttons,
    Form,
    FormControl,
    Input,
    TextArea,
    FollowUpBlock,
    FollowUpItem,
    ListBlock,
    ListItem,
    Tag,
    TagBlock,
  ],
})
