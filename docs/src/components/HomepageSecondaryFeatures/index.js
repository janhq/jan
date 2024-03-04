import styles from "../HomepageSecondaryFeatures/styles.module.css";
import clsx from "clsx";

export default function HomepageSecondaryFeatures() {
    return (
        <section className={styles.features}>
            <div className="container">
                <div className={clsx(styles.cards)}>
                    <div className={clsx(styles.card)}>
                        <div>
                            <div className={styles.cardLogo}>
                                <img alt={"Feature logo"} src={"/img/homepage-new/bg-rocket.png"}/>
                            </div>
                            <div className={styles.cardContent}>
                                <h3>Quickstart</h3>
                                <p>Jump right in with our Quickstart guide, designed to get you going with simple steps and clear instructions for a smooth setup.</p>
                            </div>
                        </div>
                        <div className={styles.cardFooter}>
                            <a href={"/guides/"}>Learn Here
                                {/* <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512" fill={"currentColor"}>
                                    <path d="M438.6 278.6c12.5-12.5 12.5-32.8 0-45.3l-160-160c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L338.8 224 32 224c-17.7 0-32 14.3-32 32s14.3 32 32 32l306.7 0L233.4 393.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0l160-160z"/>
                                </svg> */}
                            </a>
                        </div>
                    </div>
                    <div className={clsx(styles.card)}>
                        <div>
                            <div className={styles.cardLogo}>
                                <img alt={"Feature logo"} src={"/img/homepage-new/bg-wrench.png"}/>
                            </div>
                            <div className={styles.cardContent}>
                                <h3>Integrations</h3>
                                <p>Discover how Jan seamlessly integrates with 9 different system, streamlining your application for maximum efficiency.</p>
                            </div>
                        </div>
                        <div className={styles.cardFooter}>
                            <a href={"/category/integrations/"}>Learn Here
                                {/* <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512" fill={"currentColor"}>
                                    <path d="M438.6 278.6c12.5-12.5 12.5-32.8 0-45.3l-160-160c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L338.8 224 32 224c-17.7 0-32 14.3-32 32s14.3 32 32 32l306.7 0L233.4 393.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0l160-160z"/>
                                </svg> */}
                            </a>
                        </div>
                    </div>
                    <div className={clsx(styles.card)}>
                        <div>
                            <div className={styles.cardLogo}>
                                <img alt={"Feature logo"} src={"/img/homepage-new/bg-book.png"}/>
                            </div>
                            <div className={styles.cardContent}>
                                <h3>Error Codes</h3>
                                <p>Navigate through common error codes with explanations and solutions to resolve them quickly.</p>
                            </div>
                        </div>
                        <div className={styles.cardFooter}>
                            <a href={"/category/error-codes/"}>Learn Here
                                {/* <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512" fill={"currentColor"}>
                                    <path d="M438.6 278.6c12.5-12.5 12.5-32.8 0-45.3l-160-160c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L338.8 224 32 224c-17.7 0-32 14.3-32 32s14.3 32 32 32l306.7 0L233.4 393.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0l160-160z"/>
                                </svg> */}
                            </a>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}