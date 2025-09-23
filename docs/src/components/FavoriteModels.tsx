/* eslint-disable @next/next/no-img-element */
import { Button } from '@/components/ui/button'
import { motion } from 'framer-motion'
import ChatGPTIcon from '@/assets/icons/ChatGPT.svg'
import ClaudeIcon from '@/assets/icons/Claude.svg'
import GeminiIcon from '@/assets/icons/Gemini.svg'
import MetaIcon from '@/assets/icons/Meta.svg'
import MistralIcon from '@/assets/icons/Mistral AI.svg'
import QwenIcon from '@/assets/icons/Qwen.svg'
import DeepSeekIcon from '@/assets/icons/DeepSeek.svg'
import GemmaIcon from '@/assets/icons/Gemma.svg'
import KimiIcon from '@/assets/icons/Kimi.svg'
import GmailIcon from '@/assets/icons/Gmail.svg'
import AmazonIcon from '@/assets/icons/Amazone.svg'
import GoogleIcon from '@/assets/icons/Google.svg'
import NotionIcon from '@/assets/icons/Notion.svg'
import FigmaIcon from '@/assets/icons/Figma.svg'
import YoutubeIcon from '@/assets/icons/Youtube.svg'
import SlackIcon from '@/assets/icons/Slack.svg'
import GoogleDriveIcon from '@/assets/icons/Google-drive.svg'
import JiraIcon from '@/assets/icons/Jira.svg'
import Avatar from '@/assets/landing/avatar.png'

const models = [
  { name: 'ChatGPT', icon: ChatGPTIcon, company: 'OpenAI' },
  { name: 'Claude', icon: ClaudeIcon, company: 'Anthropic' },
  { name: 'Gemini', icon: GeminiIcon, company: 'Google' },
  { name: 'Llama', icon: MetaIcon, company: 'Meta' },
  { name: 'Mistral', icon: MistralIcon, company: 'Mistral AI' },
  { name: 'Qwen', icon: QwenIcon, company: 'Alibaba' },
  { name: 'DeepSeek', icon: DeepSeekIcon, company: 'DeepSeek' },
  { name: 'Gemma', icon: GemmaIcon, company: 'Google' },
  { name: 'Kimi', icon: KimiIcon, company: 'Moonshot AI' },
]

const apps = [
  { name: 'Gmail', icon: GmailIcon, description: 'Organize your inbox' },
  { name: 'Amazon', icon: AmazonIcon, description: 'Shop for products' },
  { name: 'Google', icon: GoogleIcon, description: 'Search the web' },
  { name: 'Notion', icon: NotionIcon, description: 'Write and organize' },
  { name: 'Figma', icon: FigmaIcon, description: 'Design with AI' },
  { name: 'YouTube', icon: YoutubeIcon, description: 'Look for videos' },
  { name: 'Slack', icon: SlackIcon, description: 'Read channel messages' },
  {
    name: 'Google Drive',
    icon: GoogleDriveIcon,
    description: 'Find and fetch files',
  },
  { name: 'Jira', icon: JiraIcon, description: 'Manage tickets' },
]

const thingsToRemember = [
  'Minimalist UI tasted',
  'Currently on a portfolio refresh',
  'Wants brief, to-the-point answers',
  'Frequent Figma/prototyping questions',
  'Dark-mode sharer',
  'Curious about type trends (Mostly harmless)',
]

export default function FavoriteModels() {
  return (
    <section className="container mx-auto pt-20 pb-0 md:pb-20">
      <div className="max-w-6xl mx-auto px-4">
        <motion.h2
          className="text-4xl max-w-sm font-bold mb-20 -tracking-[1.2px]"
          initial={{ opacity: 0, y: 60 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.6, delay: 0.2 }}
        >
          Best of open-source AI in one app
        </motion.h2>

        {/* Step 1: Use any model you want */}
        <motion.div
          className="mb-16"
          initial={{ opacity: 0, y: 60 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.6, delay: 0.4 }}
        >
          <div className="flex items-start gap-8 flex-col lg:flex-row">
            <div className="flex-1">
              <div className="text-[28px] mb-8 size-12 bg-white text-black rounded-full flex items-center justify-center font-semibold shadow-[0px_4px_0px_0px_rgba(0,0,0,1)] border-2 border-black">
                1
              </div>
              <h3 className="text-[28px] font-bold mb-2 max-w-sm -tracking-[0.7px]">
                Models
              </h3>
              <p className="text-gray-700 mb-4 max-w-sm text-base -tracking-[0.4px]">
                Choose from open models or plug in your favorite online models.
              </p>
              {/* <Button
                variant="playful-white"
                className="!rounded-[12px] border-2 shadow-[0px_2px_0px_0px_rgba(0,0,0,1)] text-base h-[40px]"
              >
                Explore models
              </Button> */}
            </div>
            <div className="flex-1 w-full">
              <div className="grid grid-cols-3">
                {models.map((model, index) => (
                  <div
                    key={model.name}
                    className="flex flex-col items-center border-b py-8"
                  >
                    <div className="size-11 mb-2 flex items-center justify-center">
                      <img src={model.icon.src} alt={model.name} />
                    </div>
                    <span className="text-lg font-medium -tracking-[0.4px]">
                      {model.name}
                    </span>
                    {model.company && (
                      <span className="text-sm text-gray-500 -tracking-[0.4px]">
                        {model.company}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </motion.div>

        {/* Step 2*/}
        <motion.div
          className="mb-16"
          initial={{ opacity: 0, y: 60 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.6, delay: 0.6 }}
        >
          <div className="flex items-start gap-8 flex-col lg:flex-row">
            <div className="flex-1">
              <div className="text-[28px] mb-8 size-12 bg-white text-black rounded-full flex items-center justify-center font-semibold shadow-[0px_4px_0px_0px_rgba(0,0,0,1)] border-2 border-black">
                2
              </div>
              <h3 className="text-[28px] font-bold mb-2 max-w-sm -tracking-[0.7px]">
                Connectors
              </h3>
              <p className="text-gray-700 mb-4 max-w-sm text-base -tracking-[0.4px]">
                Connect your email, files, notes and calendar. Jan works where
                you work.
              </p>
              {/* <Button
                variant="playful-white"
                className="!rounded-[12px] border-2 shadow-[0px_2px_0px_0px_rgba(0,0,0,1)] text-base h-[40px]"
              >
                Explore tools
              </Button> */}
            </div>
            <div className="flex-1 w-full">
              <div className="grid grid-cols-3">
                {apps.map((app) => (
                  <div
                    key={app.name}
                    className="flex flex-col items-center border-b py-8"
                  >
                    <div className="size-11 mb-2 flex items-center justify-center">
                      <img src={app.icon.src} alt={app.name} />
                    </div>
                    <span className="text-lg font-medium -tracking-[0.4px]">
                      {app.name}
                    </span>
                    <span className="text-sm text-gray-500 -tracking-[0.4px]">
                      {app.description}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </motion.div>

        {/* Step 3: Cross-platform */}
        <motion.div
          className="mb-16"
          initial={{ opacity: 0, y: 60 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.6, delay: 0.8 }}
        >
          <div className="flex items-start gap-8 flex-col lg:flex-row">
            <div className="flex-1">
              <div className="text-[28px] mb-8 size-12 bg-white text-black rounded-full flex items-center justify-center font-semibold shadow-[0px_4px_0px_0px_rgba(0,0,0,1)] border-2 border-black">
                3
              </div>
              <h3 className="text-[28px] font-bold mb-2 max-w-sm -tracking-[0.7px] inline-flex items-center gap-2">
                Memory{' '}
                <span className="text-sm bg-gray-200 border border-gray-300 px-2 py-1 rounded-3xl">
                  Coming Soon
                </span>
              </h3>
              <p className="text-gray-700 mb-4 max-w-sm text-base -tracking-[0.4px]">
                Your context carries over, so you don’t repeat yourself. Jan
                remembers your context and preferences.
              </p>
              {/* <Button
                variant="playful-white"
                className="!rounded-[12px] border-2 shadow-[0px_2px_0px_0px_rgba(0,0,0,1)] text-base h-[40px]"
              >
                Learn more
              </Button> */}
            </div>
            <div className="flex-1 w-full flex justify-center mt-10 px-8 md:px-0">
              <div className="relative max-w-xs scale-[70%] md:scale-100 origin-center">
                {/* Layered cards background effect */}
                <div className="absolute -inset-2 bg-purple-200 rounded-[56px] transform rotate-16 border-2 border-black shadow-[0px_3px_0px_0px_rgba(0,0,0,1)] w-[380px]"></div>
                <div className="absolute -inset-1 bg-green-200 rounded-[56px] transform rotate-6 border-2 border-black shadow-[0px_3px_0px_0px_rgba(0,0,0,1)] w-[380px]"></div>

                {/* Main card */}
                <div className="relative -rotate-3 -ml-10 bg-yellow-200 rounded-[56px] py-8 border-2 border-black shadow-[0px_3px_0px_0px_rgba(0,0,0,1)] z-10 w-[385px]">
                  {/* User profile section */}
                  <div className="flex items-center gap-4 mb-6 px-4">
                    <div className="size-24 flex items-center justify-center overflow-hidden">
                      <img
                        src={Avatar.src}
                        className="w-full h-full object-cover"
                        alt="Joe's avatar"
                      />
                    </div>
                    <div>
                      <h4 className="text-[26px] font-bold text-black">Joe</h4>
                      <p className="text-gray-700 text-xl -tracking-[0.4px]">
                        Designer, Singapore
                      </p>
                    </div>
                  </div>

                  {/* Things to remember section */}
                  <div className="">
                    <h5 className="text-xl font-bold text-black mb-4 px-4">
                      Things Jan keeps in mind
                    </h5>
                    <ul className="space-y-2 text-sm text-gray-800">
                      {thingsToRemember.map((item) => (
                        <li
                          key={item}
                          className="flex items-start gap-2 border-b border-black/10 px-4 text-black/60"
                        >
                          <span className="font-bold text-2xl -mt-0.5">•</span>
                          <span className="text-[20px] font-medium">
                            {item}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
