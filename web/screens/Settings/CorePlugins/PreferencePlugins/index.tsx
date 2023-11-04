import React from 'react'

type Props = {
  pluginName: string
  preferenceValues: any
  preferenceItems: any
}

import { useForm } from 'react-hook-form'

import { zodResolver } from '@hookform/resolvers/zod'

import { PluginService, preferences } from '@janhq/core'

import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  Input,
  FormLabel,
  FormMessage,
  Button,
} from '@janhq/uikit'

import * as z from 'zod'

import { toaster } from '@/containers/Toast'

import { formatPluginsName } from '@/utils/converter'

const PreferencePlugins = (props: Props) => {
  const { pluginName, preferenceValues, preferenceItems } = props

  const FormSchema = z.record(
    z
      .string({ required_error: 'Field is Required' })
      .min(1, { message: 'Field is Required' })
  )

  const form = useForm<z.infer<typeof FormSchema>>({
    resolver: zodResolver(FormSchema),
    defaultValues: preferenceValues.reduce(
      (obj: any, item: { key: any; value: any }) =>
        Object.assign(obj, { [item.key]: item.value }),
      {}
    ),
  })

  const onSubmit = async (values: z.infer<typeof FormSchema>) => {
    for (const [key, value] of Object.entries(values)) {
    }
    toaster({
      title: formatPluginsName(pluginName),
      description: 'Success update preferences',
    })
  }

  return (
    <div className="mx-auto w-full lg:mt-10 lg:w-1/2">
      <h6 className="mb-6 text-lg font-semibold capitalize">
        {formatPluginsName(pluginName)}
      </h6>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
          {preferenceItems
            .filter((x: any) => x.pluginName === pluginName)
            ?.map((e: any) => (
              <FormField
                key={e.preferenceKey}
                control={form.control}
                name={e.preferenceKey}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{e.preferenceName}</FormLabel>
                    <FormDescription className="mb-2">
                      {e.preferenceDescription}
                    </FormDescription>
                    <FormControl>
                      <Input
                        placeholder={`Enter your ${e.preferenceName}`}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ))}
          <Button type="submit" block>
            Submit
          </Button>
        </form>
      </Form>
    </div>
  )
}

export default PreferencePlugins
