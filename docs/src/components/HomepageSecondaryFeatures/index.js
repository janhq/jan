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
                                <h3>Praesent vel Felis Vehicula</h3>
                                <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Suspendisse congue tempus ligula. Aenean finibus lectus massa, non laoreet est bibendum in.</p>
                            </div>
                        </div>
                        <div className={styles.cardFooter}>
                            <a href={"#"}>Learn Here
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512" fill={"currentColor"}>
                                    <path d="M438.6 278.6c12.5-12.5 12.5-32.8 0-45.3l-160-160c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L338.8 224 32 224c-17.7 0-32 14.3-32 32s14.3 32 32 32l306.7 0L233.4 393.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0l160-160z"/>
                                </svg>
                            </a>
                        </div>
                    </div>
                    <div className={clsx(styles.card)}>
                        <div>
                            <div className={styles.cardLogo}>
                                <img alt={"Feature logo"} src={"/img/homepage-new/bg-wrench.png"}/>
                            </div>
                            <div className={styles.cardContent}>
                                <h3>Praesent vel Felis Vehicula</h3>
                                <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Suspendisse congue tempus ligula. Aenean finibus lectus massa, non laoreet est bibendum in.</p>
                            </div>
                        </div>
                        <div className={styles.cardFooter}>
                            <a href={"#"}>Learn Here
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512" fill={"currentColor"}>
                                    <path d="M438.6 278.6c12.5-12.5 12.5-32.8 0-45.3l-160-160c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L338.8 224 32 224c-17.7 0-32 14.3-32 32s14.3 32 32 32l306.7 0L233.4 393.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0l160-160z"/>
                                </svg>
                            </a>
                        </div>
                    </div>
                    <div className={clsx(styles.card)}>
                        <div>
                            <div className={styles.cardLogo}>
                                <img alt={"Feature logo"} src={"/img/homepage-new/bg-book.png"}/>
                            </div>
                            <div className={styles.cardContent}>
                                <h3>Praesent vel Felis Vehicula</h3>
                                <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Suspendisse congue tempus ligula. Aenean finibus lectus massa, non laoreet est bibendum in.</p>
                            </div>
                        </div>
                        <div className={styles.cardFooter}>
                            <a href={"#"}>Learn Here
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512" fill={"currentColor"}>
                                    <path d="M438.6 278.6c12.5-12.5 12.5-32.8 0-45.3l-160-160c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L338.8 224 32 224c-17.7 0-32 14.3-32 32s14.3 32 32 32l306.7 0L233.4 393.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0l160-160z"/>
                                </svg>
                            </a>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}
