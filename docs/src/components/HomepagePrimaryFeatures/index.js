export default function HomepagePrimaryFeatures() {
    return (
        <section className="py-8 md:py-16 lg:py-20 flex items-center">
            <div className="container">
                <div className="flex flex-col md:flex-row justify-between md:gap-8">
                    <div className="w-full md:w-1/2 h-72 md:h-84 flex-1 rounded-lg p-8 relative bg-gradient-to-r from-gray-100 to-blue-400 dark:from-gray-700 dark:to-blue-800 mb-8 md:mb-0">
                        <div className="mb-16">
                            <p className="text-lg mb-4">Installation</p>
                            <h3 className="text-1xl md:text-2xl lg:text-3xl font-semibold">Install Jan across multiple platforms.</h3>
                        </div>
                        <div>
                            <a href={"/guides/install"} className="btn bg-black hover:bg-gray-600 dark:bg-blue-500 text-normal md:text-xl text-white font-normal py-2 px-4 rounded-xl">Get Started</a>
                        </div>
                        <div className="absolute right-4 bottom-4">
                            <img alt={"Card Image"} src={"/img/homepage-new/rocket.png"} className="h-16 md:h-24" />
                        </div>
                    </div>
                    <div className="w-full md:w-1/2 h-72 md:h-84 flex-1 rounded-lg p-8 relative bg-gradient-to-r from-gray-100 to-purple-400 dark:from-gray-700 dark:to-purple-800">
                        <div className="mb-8">
                            <p className="text-lg mb-4">Models</p>
                            <h3 className="text-1xl md:text-2xl lg:text-3xl font-semibold">Discover the pre-configured AI models available for use. </h3>
                        </div>
                        <div>
                            <a href={"/guides/models-list"} className="btn bg-black hover:bg-gray-600 dark:bg-blue-500 text-normal md:text-xl text-white font-normal py-2 px-4 rounded-xl">Support</a>
                        </div>
                        <div className="absolute right-4 bottom-4">
                            <img alt={"Card Image"} src={"/img/homepage-new/chat.png"} className="h-16 md:h-24" />
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}
