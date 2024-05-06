import React, { ReactNode } from 'react'
import * as AccordionPrimitive from '@radix-ui/react-accordion'

import { ChevronDownIcon } from '@radix-ui/react-icons'

import './styles.scss'

type AccordionProps = {
  defaultValue: string[]
  children: ReactNode
}

type AccordionItemProps = {
  children: ReactNode
  value: string
  title: string
}

const AccordionItem = ({ children, value, title }: AccordionItemProps) => {
  return (
    <AccordionPrimitive.Item className="accordion__item" value={value}>
      <AccordionPrimitive.Header className="accordion__header">
        <AccordionPrimitive.Trigger className="accordion__trigger">
          <h6>{title}</h6>
          <ChevronDownIcon className="accordion__chevron" aria-hidden />
        </AccordionPrimitive.Trigger>
      </AccordionPrimitive.Header>
      <AccordionPrimitive.Content className="accordion__content">
        <div className="accordion__content--wrapper">{children}</div>
      </AccordionPrimitive.Content>
    </AccordionPrimitive.Item>
  )
}

const Accordion = ({ defaultValue, children }: AccordionProps) => (
  <AccordionPrimitive.Root
    className="accordion"
    type="multiple"
    defaultValue={defaultValue}
  >
    {children}
  </AccordionPrimitive.Root>
)

export { Accordion, AccordionItem }
