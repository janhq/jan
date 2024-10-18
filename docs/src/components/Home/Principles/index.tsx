import LogoMark from '@/components/LogoMark'

const Principles = () => {
  return (
    <div className="px-4 lg:px-8 mt-10 pb-24 lg:mt-20">
      <div className="nx-mx-auto nx-flex nx-max-w-[90rem] nx-pl-[max(env(safe-area-inset-left),1.5rem)] nx-pr-[max(env(safe-area-inset-right),1.5rem)]">
        <div className="w-full mx-auto relative pt-8 text-center">
          <h1 className="text-5xl lg:text-7xl !font-normal leading-tight lg:leading-tight mt-2 font-serif">
            Our Principles
          </h1>
          <p className="leading-relaxed mt-2 text-black/60 dark:text-white/60 flex gap-x-2 justify-center">
            Jan is opinionated software on what AI should be
            <svg
              width="24"
              height="24"
              className="lg:inline-block hidden"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M10.5 0H15V1.5H13.5V3H18V4.5H16.5V6H15V7.5H13.5V9H12V10.5H13.5V12H15V13.5H10.5V16.5H9V12H7.5V10.5H6V9H7.5V7.5H9V6H10.5V4.5H12V1.5H10.5V0Z"
                className="fill-black/60 dark:fill-white/60"
              />
              <path
                d="M21 0H22.5V1.5H21V0Z"
                className="fill-black/60 dark:fill-white/60"
              />
              <path
                d="M9 1.5H10.5V4.5H9V1.5Z"
                className="fill-black/60 dark:fill-white/60"
              />
              <path
                d="M18 1.5H21V3H18V1.5Z"
                className="fill-black/60 dark:fill-white/60"
              />
              <path
                d="M4.5 10.5H6V12H4.5V10.5Z"
                className="fill-black/60 dark:fill-white/60"
              />
              <path
                d="M3 12H4.5V13.5H3V12Z"
                className="fill-black/60 dark:fill-white/60"
              />
              <path
                d="M0 13.5H3V15H0V13.5Z"
                className="fill-black/60 dark:fill-white/60"
              />
              <path
                d="M15 13.5H16.5V15H21V16.5H15V13.5Z"
                className="fill-black/60 dark:fill-white/60"
              />
              <path
                d="M7.5 16.5H9V18H12V19.5H7.5V21H3V19.5H6V18H7.5V16.5Z"
                className="fill-black/60 dark:fill-white/60"
              />
              <path
                d="M12 16.5H15V18H12V16.5Z"
                className="fill-black/60 dark:fill-white/60"
              />
              <path
                d="M21 16.5H22.5V18H21V16.5Z"
                className="fill-black/60 dark:fill-white/60"
              />
              <path
                d="M15 18H16.5V19.5H15V18Z"
                className="fill-black/60 dark:fill-white/60"
              />
              <path
                d="M19.5 18H21V19.5H19.5V18Z"
                className="fill-black/60 dark:fill-white/60"
              />
              <path
                d="M16.5 19.5H19.5V21H16.5V19.5Z"
                className="fill-black/60 dark:fill-white/60"
              />
              <path
                d="M1.5 21H3V22.5H1.5V21Z"
                className="fill-black/60 dark:fill-white/60"
              />
              <path
                d="M7.5 21H9V22.5H12V24H3V22.5H7.5V21Z"
                className="fill-black/60 dark:fill-white/60"
              />
              <path
                d="M12 21H16.5V22.5H12V21Z"
                className="fill-black/60 dark:fill-white/60"
              />
            </svg>
          </p>
          <div className="grid grid-cols-1 gap-8 mt-16 text-center">
            <div className="lg:w-2/5 mx-auto">
              <svg
                className="mx-auto"
                width="32"
                height="32"
                viewBox="0 0 32 32"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M28.96 13.72V9.14H27.43V10.67H24.39V7.62H25.91V6.1H22.86V3.05H21.34V0H4.58V1.52H1.53V13.72H0V32H32V13.72H28.96ZM22.86 7.62V12.19H27.43V13.72H15.24V7.62H22.86ZM3.05 3.05H4.58V13.72H3.05V3.05ZM9.15 18.29H7.62V19.81H4.58V18.29H3.05V16.76H9.15V18.29ZM9.15 13.72H6.1V1.52H19.81V3.05H9.15V13.72ZM10.67 4.57H21.34V6.1H13.72V13.72H10.67V4.57ZM30.48 30.48H12.2V15.24H30.48V30.48Z"
                  fill="#4377E9"
                />
                <path
                  d="M28.9601 22.86H27.4301V24.38H28.9601V22.86Z"
                  fill="#4377E9"
                />
                <path
                  d="M28.9601 27.43H19.8101V28.95H28.9601V27.43Z"
                  fill="#4377E9"
                />
                <path d="M27.43 7.62H25.91V9.14H27.43V7.62Z" fill="#4377E9" />
                <path
                  d="M25.91 24.38H22.86V25.91H25.91V24.38Z"
                  fill="#4377E9"
                />
                <path
                  d="M21.3401 22.86H19.8101V24.38H21.3401V22.86Z"
                  fill="#4377E9"
                />
              </svg>
              <h5 className="mt-4 mb-2 text-lg font-semibold">Local-first</h5>
              <p className="text-black/60 dark:text-white/60 leading-relaxed">
                {`We believe your conversations and files should remain yours
                alone. That's why we prioritize local-first AI, running
                open-source models directly on your computer.`}
              </p>
            </div>
            <div className="lg:w-2/5 mx-auto">
              <svg
                className="mx-auto"
                width="29"
                height="32"
                viewBox="0 0 29 32"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M28.9495 22.8602H24.3795V21.3302H25.8995V19.8103H3.04994V21.3302H4.57491V22.8602H0V32H28.9495V22.8602ZM6.08989 21.3302H22.8496V22.8602H6.08989V21.3302ZM27.4295 30.4801H1.51997V24.3802H27.4295V30.4801Z"
                  fill="#4377E9"
                />
                <path
                  d="M27.4294 1.52042H25.8994V19.8101H27.4294V1.52042Z"
                  fill="#4377E9"
                />
                <path
                  d="M24.3795 25.8996H16.7596V27.4296H24.3795V25.8996Z"
                  fill="#4377E9"
                />
                <path
                  d="M18.2796 10.6697H16.7596V12.1897H18.2796V10.6697Z"
                  fill="#4377E9"
                />
                <path
                  d="M18.2796 7.62H16.7596V9.13997H18.2796V7.62Z"
                  fill="#4377E9"
                />
                <path
                  d="M16.7596 12.1889H12.1897V13.7089H16.7596V12.1889Z"
                  fill="#4377E9"
                />
                <path
                  d="M12.1896 10.6697H10.6597V12.1897H12.1896V10.6697Z"
                  fill="#4377E9"
                />
                <path
                  d="M12.1896 7.62H10.6597V9.13997H12.1896V7.62Z"
                  fill="#4377E9"
                />
                <path
                  d="M4.57483 18.2895H24.3845V3.04974H4.57483V18.2895ZM6.0898 4.56972H22.8495V16.7595H6.0898V4.56972Z"
                  fill="#4377E9"
                />
                <path
                  d="M7.61977 25.8996H4.56982V28.9495H7.61977V25.8996Z"
                  fill="#4377E9"
                />
                <path
                  d="M25.8995 0H3.04993V1.51997H25.8995V0Z"
                  fill="#4377E9"
                />
                <path
                  d="M3.04987 1.52042H1.5199V19.8101H3.04987V1.52042Z"
                  fill="#4377E9"
                />
              </svg>
              <h5 className="mt-4 mb-2 text-lg font-semibold">User-owned</h5>
              <p className="text-black/60 dark:text-white/60 leading-relaxed">
                Your data, your rules. Jan stores everything on your device in
                universal formats, giving you total freedom to move your data
                without tricks or traps.
              </p>
            </div>
            <div className="lg:w-2/5 mx-auto">
              <svg
                className="mx-auto"
                width="28"
                height="32"
                viewBox="0 0 28 32"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M27.715 9.90503H26.185V28.195H27.715V9.90503Z"
                  fill="#4377E9"
                />
                <path
                  d="M26.185 28.195H24.665V29.715H26.185V28.195Z"
                  fill="#4377E9"
                />
                <path
                  d="M26.185 8.38501H24.665V9.90501H26.185V8.38501Z"
                  fill="#4377E9"
                />
                <path
                  d="M24.665 29.715H3.33496V31.235H24.665V29.715Z"
                  fill="#4377E9"
                />
                <path
                  d="M24.665 6.85501H18.565V8.38501H24.665V6.85501Z"
                  fill="#4377E9"
                />
                <path
                  d="M18.565 3.80502H17.045V6.85502H18.565V3.80502Z"
                  fill="#4377E9"
                />
                <path
                  d="M17.045 2.285H15.525V3.805H17.045V2.285Z"
                  fill="#4377E9"
                />
                <path
                  d="M15.525 0.765015H12.475V2.28501H15.525V0.765015Z"
                  fill="#4377E9"
                />
                <path
                  d="M12.4749 2.285H10.9449V3.805H12.4749V2.285Z"
                  fill="#4377E9"
                />
                <path
                  d="M10.945 3.80502H9.42499V6.85502H10.945V3.80502Z"
                  fill="#4377E9"
                />
                <path
                  d="M7.905 17.525H6.375V20.575H7.905V17.525Z"
                  fill="#4377E9"
                />
                <path
                  d="M6.37498 20.575H4.85498V22.095H6.37498V20.575Z"
                  fill="#4377E9"
                />
                <path
                  d="M6.37498 15.995H4.85498V17.525H6.37498V15.995Z"
                  fill="#4377E9"
                />
                <path
                  d="M9.42496 6.85501H3.33496V8.38501H9.42496V6.85501Z"
                  fill="#4377E9"
                />
                <path
                  d="M1.80497 14.475V9.90503H0.284973V15.995H4.85497V14.475H1.80497Z"
                  fill="#4377E9"
                />
                <path
                  d="M3.33499 28.195H1.80499V29.715H3.33499V28.195Z"
                  fill="#4377E9"
                />
                <path
                  d="M3.33499 8.38501H1.80499V9.90501H3.33499V8.38501Z"
                  fill="#4377E9"
                />
                <path
                  d="M1.80497 23.615H4.85497V22.095H0.284973V28.195H1.80497V23.615Z"
                  fill="#4377E9"
                />
              </svg>
              <h5 className="mt-4 mb-2 text-lg font-semibold">
                Fully Customizable
              </h5>
              <p className="text-black/60 dark:text-white/60 leading-relaxed">
                You can endlessly customize the experience with 3rd party
                extensions. You can adjust alignment, moderation, and censorship
                levels to your needs.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Principles
