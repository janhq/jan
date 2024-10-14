import { Fragment } from 'react'

import Hero from '@/components/Home/Hero'
import BuiltWithLove from '@/components/Home/BuiltWithLove'
import WallOfLove from '@/components/Home/WallOfLove'
import Feature from '@/components/Home/Feature'
import Principles from './Principles'
import CTANewsletter from './CTANewsletter'
import Statistic from './Statistic'
import CTADownload from './CTADownload'
import Customizable from './Customizable'
// import APIStructure from './APIStructure'

const Home = () => {
  return (
    <Fragment>
      <Hero />
      <BuiltWithLove />
      <Feature />
      {/* <APIStructure /> */}
      <Customizable />
      <WallOfLove />
      <Principles />
      <CTANewsletter />
      <Statistic />
      <CTADownload />
    </Fragment>
  )
}

export default Home
