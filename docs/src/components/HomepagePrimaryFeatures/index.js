import styles from "../HomepagePrimaryFeatures/styles.module.css";
import clsx from "clsx";

export default function HomepagePrimaryFeatures() {
    return (
        <section className={styles.features}>
            <div className="container">
                <div className={clsx(styles.cards)}>
                    <div className={clsx(styles.card, styles.cardBluish)}>
                        <div>
                            <p>Installation</p>
                            <h3>Set up Jan with our guide, ensuring a smooth installation process across multiple platforms.</h3>
                        </div>
                        <div >
                            <a href={"/quickstart/install"}>Get Started</a>
                        </div>
                        <div className={styles.cardImage}>
                            <img alt={"Card Image"} src={"/img/homepage-new/rocket.png"} />
                        </div>
                    </div>
                    <div className={clsx(styles.card, styles.cardPinkish)}>
                        <div>
                            <p>Models</p>
                            <h3>Explore the available AI models, each pre-configured for immediate use to streamline your projects.</h3>
                        </div>
                        <div >
                            <a href={"/quickstart/models-list"}>Support</a>
                        </div>
                        <div className={styles.cardImage}>
                            <img alt={"Card Image"} src={"/img/homepage-new/chat.png"} />
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}
