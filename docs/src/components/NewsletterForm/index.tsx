import { Fragment, useState } from 'react'
import { useForm } from 'react-hook-form'

const NewsletterForm = ({ id }: { id: number }) => {
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
        listIds: [id],
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
    <Fragment>
      <form className="relative" onSubmit={handleSubmit(onSubmit)}>
        <input
          type="email"
          className="lg:ml-0.5 w-full h-12 p-4 pr-14 rounded-xl bg-white border dark:border-gray-600 dark:bg-[#252525] border-[#F0F0F0] focus-visible:ring-0"
          placeholder="Enter your email to receive our updates"
          autoComplete="off"
          {...register('email')}
        />
        <button
          type="submit"
          className="absolute flex p-2 bg-black dark:bg-[#3B3B3C] w-8 h-8 border dark:border-gray-600 rounded-lg top-1/2 right-3 -translate-y-1/2"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M6.09026 8.41933L3.72077 7.62985C1.24061 6.80348 0 6.3903 0 5.63033C0 4.87142 1.24061 4.45718 3.72077 3.63081L12.6938 0.639442C14.4393 0.0576106 15.3121 -0.233305 15.7727 0.227312C16.2333 0.687928 15.9424 1.56068 15.3616 3.30512L12.3692 12.2792C11.5428 14.7594 11.1296 16 10.3697 16C9.61076 16 9.19652 14.7594 8.37015 12.2792L7.57962 9.9108L12.1689 5.3215C12.3609 5.1227 12.4672 4.85645 12.4648 4.58008C12.4624 4.30372 12.3515 4.03935 12.1561 3.84392C11.9607 3.64849 11.6963 3.53764 11.4199 3.53524C11.1435 3.53284 10.8773 3.63908 10.6785 3.83108L6.09026 8.41933Z"
              fill="white"
            />
          </svg>
        </button>
      </form>
      {formMessage && <p className="text-left mt-4">{formMessage}</p>}
    </Fragment>
  )
}

export default NewsletterForm
