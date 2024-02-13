import styles from "../HomepagePrimaryFeatures/styles.module.css";
import clsx from "clsx";

export default function HomepagePrimaryFeatures() {
    return (
        <section className={styles.features}>
            <div className="container">
                <div className={clsx(styles.cards)}>
                    <div className={clsx(styles.card, styles.cardBluish)}>
                        <div>
                            <p>Lorem ipsum dolor</p>
                            <h3>Pellentesque varius euismod consequat. Vestibulum nec laoreet nulla.</h3>
                        </div>
                        <div >
                            <a href={"#"}>Get Started</a>
                        </div>
                        <div className={styles.cardImage}>
                            <img alt={"Card Image"} src={"/img/homepage-new/rocket.png"} />
                        </div>
                    </div>
                    <div className={clsx(styles.card, styles.cardPinkish)}>
                        <div>
                            <p>Lorem ipsum dolor</p>
                            <h3>Pellentesque varius euismod consequat. Vestibulum nec laoreet nulla.</h3>
                        </div>
                        <div >
                            <a href={"#"}>Support</a>
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
