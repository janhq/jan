/* eslint-disable @typescript-eslint/naming-convention */
import { SubmitHandler, useForm } from 'react-hook-form'

import { Button, Input } from '@janhq/uikit'
import { useAtom, useSetAtom } from 'jotai'

import { ArrowLeftIcon, ExternalLinkIcon } from 'lucide-react'
import { AiOutlineGithub } from 'react-icons/ai'
import { BiLogoDiscordAlt, BiLogoLinkedin } from 'react-icons/bi'
import { FaSquareXTwitter } from 'react-icons/fa6'

import { modalOnboardingAccesibilityAtom, onBoardingStepAtom } from '..'

type FormMail = {
  email: string
}

const socials = [
  {
    icon: <AiOutlineGithub className="stroke-none text-4xl" />,
    href: 'https://github.com/janhq/jan',
    name: 'Github',
  },
  {
    icon: <BiLogoDiscordAlt className="stroke-none text-4xl" />,
    href: 'https://discord.com/invite/FTk2MvZwJH',
    name: 'Discord ',
  },
  {
    icon: <FaSquareXTwitter className="stroke-none text-4xl" />,
    href: 'https://twitter.com/janframework',
    name: 'X',
    desc: 'Product updates, news.',
  },
  {
    icon: <BiLogoLinkedin className="stroke-none text-4xl" />,
    href: 'https://www.linkedin.com/company/janframework/',
    name: 'LinkedIn',
    desc: 'We’re hiring!',
  },
]

const AllSetOnBoarding = () => {
  const [onBoardingStep, setOnBoardingStep] = useAtom(onBoardingStepAtom)
  const setAccessibilityCheckbox = useSetAtom(modalOnboardingAccesibilityAtom)
  const { register, handleSubmit } = useForm<FormMail>()

  const onSubmit: SubmitHandler<FormMail> = async (data) => {
    const { email } = data
    const options = {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'api-key':
          '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',
      },
      body: JSON.stringify({
        updateEnabled: false,
        email,
        listIds: [10],
      }),
    }

    fetch('https://api.brevo.com/v3/contacts', options)
      .then((response) => response.json())
      .then((response) => console.log(response))
      .catch((err) => console.error(err))
      .then(async () => {
        await window.core?.api?.updateAppConfiguration({
          finish_onboarding: true,
        })
        window.core?.api?.relaunch()
      })
  }

  return (
    <div className="flex w-full cursor-pointer p-2">
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="item-center flex h-full w-3/5 flex-shrink-0 flex-col items-center justify-between rounded-lg bg-white px-8 py-14 dark:bg-background/50"
      >
        <div className="w-full text-center">
          <h1 className="mt-2 text-3xl font-bold">All Set!</h1>
          <p className="mt-2 text-base font-medium text-muted-foreground">
            Enter your email to get notified of latest releases and features.
          </p>
          <div className="mx-auto mt-10 flex w-3/5 items-center gap-x-3">
            <Input
              {...register('email')}
              type="email"
              placeholder="Enter your email address (optional)"
              onChange={(e) => console.log(e.target.value)}
            />
          </div>
        </div>
        <div className="flex w-3/4 gap-4">
          <Button
            size="lg"
            type="button"
            themes="outline"
            className="w-12 p-0"
            onClick={() => {
              setAccessibilityCheckbox(false)
              setOnBoardingStep(onBoardingStep - 1)
            }}
          >
            <ArrowLeftIcon size={20} />
          </Button>
          <Button block size="lg" type="submit">
            Get Started
          </Button>
        </div>
      </form>
      <div className="flex w-full items-center justify-center p-8">
        <div className="flex h-full w-full flex-col items-center justify-center">
          {socials.map((social, i) => {
            return (
              <a
                aria-label={`social-${i}`}
                key={i}
                href={social.href}
                target="_blank"
                className="my-2 flex w-full items-center gap-4 rounded-lg bg-white/80 p-4 backdrop-blur-3xl  dark:bg-background/80"
                rel="noopener"
              >
                {social.icon}
                <div className="flex w-full items-center justify-between">
                  <div>
                    <h6 className="mb-1 text-lg font-bold">{social.name}</h6>
                    <p className="text-muted-foreground">{social.desc}</p>
                  </div>
                  <ExternalLinkIcon
                    className="text-muted-foreground"
                    size={20}
                  />
                </div>
              </a>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default AllSetOnBoarding
