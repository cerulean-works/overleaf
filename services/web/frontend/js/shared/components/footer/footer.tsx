import { FooterMetadata } from '@/shared/components/types/footer-metadata'
import ThinFooter from '@/shared/components/footer/thin-footer'
import FatFooter from '@/shared/components/footer/fat-footer'
import getMeta from '@/utils/meta'

function Footer(props: FooterMetadata) {
  if (getMeta('ol-ExposedSettings').env === 'server-ce') {
    return null
  }
  return props.showThinFooter ? <ThinFooter {...props} /> : <FatFooter />
}

export default Footer
