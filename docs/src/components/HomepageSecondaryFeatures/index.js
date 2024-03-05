import React from 'react'

export default function HomepageSecondaryFeatures() {
    return (
        <section className="py-8 md:py-16 bg-gray-100 dark:bg-gray-800 flex items-center">
            <div className="container">
                <div className="flex flex-col md:flex-row justify-center gap-8">
                    <FeatureCard
                        imgSrc="/img/homepage-new/bg-rocket.png"
                        title="Quickstart"
                        description="Get started quickly with our Quickstart guide, offering simple steps for a smooth setup."
                        href="/guides/"
                    />
                    <FeatureCard
                        imgSrc="/img/homepage-new/bg-wrench.png"
                        title="Integrations"
                        description="Learn how Jan can integrates seamlessly."
                        href="/guides/integrations/"
                    />
                    <FeatureCard
                        imgSrc="/img/homepage-new/bg-book.png"
                        title="Error Codes"
                        description="Find solutions for common error codes to resolve them quickly."
                        href="/guides/error-codes/"
                    />
                </div>
            </div>
        </section>
    )
}

function FeatureCard({ imgSrc, title, description, href }) {
    return (
        <div className="bg-gray-200 dark:bg-gray-700 w-full rounded-lg relative flex flex-col justify-between mb-8 md:mb-0 md:mr-8 p-2">
            <div>
                <div className="h-32 w-full">
                    <img alt={'Feature logo'} src={imgSrc} />
                </div>
                <div className="mt-12 p-8">
                    <h3 className="text-lg font-semibold">{title}</h3>
                    <p>{description}</p>
                </div>
            </div>
            <div className="p-8 mb-2 pt-0">
                <a
                    href={href}
                    className="btn bg-black hover:bg-gray-600 dark:bg-blue-500 text-white font-normal py-2 px-4 rounded-xl"
                >
                    Learn more
                </a>
            </div>
        </div>
    )
}
