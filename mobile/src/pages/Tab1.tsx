import {
  IonContent,
  IonHeader,
  IonPage,
  IonTitle,
  IonToolbar,
} from '@ionic/react'
import { Badge, Button, Progress, Textarea } from '@janhq/uikit'
import ExploreContainer from '../components/ExploreContainer'
import './Tab1.css'

const Tab1: React.FC = () => {
  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Tab 1</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen>
        <IonHeader collapse="condense">
          <IonToolbar>
            <IonTitle size="large">Tab 1</IonTitle>
          </IonToolbar>
        </IonHeader>
        <ExploreContainer name="Jan.AI Tab 1 page" />
        <Button size="lg" themes="primary">
          Click me
        </Button>

        <Textarea
          id="assistant-instructions"
          placeholder="Eg. You are a helpful assistant."
          className="px-4"
        />

        <Badge themes="secondary">-</Badge>
      </IonContent>
    </IonPage>
  )
}

export default Tab1
