import { useForm } from 'react-hook-form'
import ThemeImage from '@/components/ThemeImage'
import { useState } from 'react'

const CTANewsletter = () => {
  const { register, handleSubmit, reset } = useForm({
    defaultValues: {
      email: '',
    },
  })

  const [formMessage, setFormMessage] = useState('')

  const onSubmit = (data: { email: string }) => {
    const { email } = data
    const options = {
      method: 'POST',

      body: JSON.stringify({
        updateEnabled: false,
        email,
        listIds: [13],
      }),
    }

    if (email) {
      fetch('https://brevo.jan.ai/', options)
        .then((response) => response.json())
        .then((response) => {
          if (response.id) {
            setFormMessage('You have successfully joined our newsletter')
          } else {
            setFormMessage(response.message)
          }
          reset()
          setTimeout(() => {
            setFormMessage('')
          }, 5000)
        })
        .catch((err) => console.error(err))
    }
  }

  return (
    <div className="bg-[#F0F0F0] dark:bg-[#242424] text-center py-16">
      <div className="nextra-wrap-container">
        <div className="w-full xl:w-10/12 mx-auto relative">
          <div className="flex p-4 lg:justify-between flex-col lg:flex-row items-end">
            <div className="w-full">
              <ThemeImage
                className="w-28 mx-auto h-auto"
                source={{
                  light: '/assets/images/homepage/mac-system-black.svg',
                  dark: '/assets/images/homepage/mac-system-white.svg',
                }}
                alt="App screenshots"
                width={800}
                height={800}
              />
              <h1 className="text-5xl lg:text-7xl !font-normal leading-tight lg:leading-tight font-serif mt-8">
                The Soul of a New Machine
              </h1>
              <p className="leading-relaxed text-black/60 dark:text-white/60">
                Follow our AI research and journey in building Jan
              </p>

              <div className="w-full lg:w-1/2 mt-8 mx-auto">
                <form className="relative" onSubmit={handleSubmit(onSubmit)}>
                  <input
                    type="email"
                    autoComplete="off"
                    className="w-full h-16 p-4 pr-14 rounded-xl border bg-white border-[#F0F0F0] dark:bg-white/10 dark:border-gray-600 focus-visible:ring-0"
                    placeholder="Enter your email"
                    {...register('email')}
                  />
                  <button
                    type="submit"
                    className="absolute flex p-2 px-4 items-center dark:text-black bg-black text-white dark:bg-white h-12 border border-gray-600 rounded-lg top-1/2 right-3 -translate-y-1/2 font-medium"
                  >
                    Subscribe
                  </button>
                </form>
                {formMessage && <p className="text-left mt-4">{formMessage}</p>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default CTANewsletter
