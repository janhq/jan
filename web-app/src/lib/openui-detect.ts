const OPENUI_FENCE_RE =
  /```(?:openui|openui-lang|openuilang|genui|ui)\s*\n?([\s\S]*?)```/i

const ROOT_ASSIGNMENT_RE = /^root\s*=/m
const ROOT_AT_START_RE = /^root\s*=/
const ROOT_TARGET_RE = /^root\s*=\s*([A-Za-z_][A-Za-z0-9_]*)/m
const OPENUI_COMPONENT_NAMES = [
  'Accordion',
  'AreaChart',
  'BarChart',
  'Button',
  'Buttons',
  'Callout',
  'Card',
  'CardHeader',
  'Carousel',
  'CheckBoxGroup',
  'CheckBoxItem',
  'CodeBlock',
  'Col',
  'DatePicker',
  'FollowUpBlock',
  'FollowUpItem',
  'Form',
  'FormControl',
  'HorizontalBarChart',
  'Image',
  'ImageBlock',
  'ImageGallery',
  'Input',
  'LineChart',
  'ListBlock',
  'ListItem',
  'MarkDownRenderer',
  'Modal',
  'PieChart',
  'Point',
  'RadarChart',
  'RadioGroup',
  'RadioItem',
  'RadialChart',
  'ScatterChart',
  'ScatterSeries',
  'SectionBlock',
  'SectionItem',
  'Select',
  'SelectItem',
  'Separator',
  'Series',
  'SingleStackedBarChart',
  'Slice',
  'Slider',
  'Stack',
  'Steps',
  'StepsItem',
  'SwitchGroup',
  'SwitchItem',
  'Table',
  'Tabs',
  'TabItem',
  'Tag',
  'TagBlock',
  'TextArea',
  'TextCallout',
  'TextContent',
] as const

export function extractOpenUIResponse(content: string): string | null {
  const fenced = OPENUI_FENCE_RE.exec(content)
  if (fenced?.[1]) {
    const candidate = fenced[1].trim()
    return isLikelyOpenUILang(candidate) ? candidate : null
  }

  const trimmed = content.trim()
  if (!ROOT_AT_START_RE.test(trimmed)) return null
  return isLikelyOpenUILang(trimmed) ? trimmed : null
}

export function isLikelyOpenUILang(content: string) {
  if (!ROOT_ASSIGNMENT_RE.test(content)) return false

  const rootTarget = ROOT_TARGET_RE.exec(content)?.[1]
  if (!rootTarget) return false

  if ((OPENUI_COMPONENT_NAMES as readonly string[]).includes(rootTarget)) {
    return new RegExp(`^root\\s*=\\s*${rootTarget}\\s*\\(`, 'm').test(content)
  }

  const escapedTarget = rootTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(
    `^${escapedTarget}\\s*=\\s*(?:${OPENUI_COMPONENT_NAMES.join('|')})\\s*\\(`,
    'm'
  ).test(content)
}
