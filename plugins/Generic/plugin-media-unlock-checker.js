/**
 * 本插件参考代码：https://github.com/clash-verge-rev/clash-verge-rev/tree/dev/src-tauri/src/cmd/media_unlock_checker
 */

/* 触发器 手动触发 */
const onRun = async () => {
  const modal = Plugins.modal({
    title: Plugin.name,
    cancelText: 'common.close',
    submit: false,
    afterClose: () => {
      modal.destroy()
    }
  })

  const content = {
    template: `
    <div v-if="!done" class="flex items-center justify-center min-h-128">
      <Button @click="onClick" :loading="loading" type="primary" size="large"> 
        {{ loading ? '正在检测...' + (progress + '/' + length) : '开始检测' }}
      </Button>
    </div>
    <template v-else>
      <div class="flex items-center justify-between py-16 px-8">
        <div class="font-bold text-16">检测结束，用时：{{duration}}</div>
        <Button @click="onClick" type="primary">重新检测</Button>
      </div>
      <div class="grid grid-cols-4 gap-8 p-8">
        <Card v-for="item in result" :key="item.result.name" :title="item.result.name">
          <div class="flex items-center justify-between">
            <div>{{item.result.status}} {{item.result.region}}</div>
            <div class="text-12">{{item.duration}}</div>
          </div>
        </Card>
      </div>
    </template>
    `,
    setup() {
      const { ref } = Vue

      const list = Object.values(Checker).filter((v) => !v.skip)
      const length = list.length

      const result = ref([])
      const loading = ref(false)
      const progress = ref(0)
      const done = ref(false)
      const duration = ref()

      const check = async () => {
        const promises = list.map(async (v) => {
          const startTime = Date.now()
          const result = await v.check()
          const endTime = Date.now()
          progress.value += 1
          return { result, duration: (endTime - startTime) / 1000 + 's' }
        })

        const startTime = Date.now()
        const rows = await Promise.all(promises)
        duration.value = (Date.now() - startTime) / 1000 + 's'
        rows.forEach((row) => {
          row.result.status = row.result.status?.replace('Yes', '✅')?.replace('No', '❌')
          row.result.region = row.result.region || '-'
          if (row.result.status.includes('Client.Timeout')) {
            row.result.status = '😤连接超时'
          }
          if (row.result.region?.includes('Client.Timeout')) {
            row.result.region = '😤连接超时'
          }
          row.result.region = countryCodeToEmoji(row.result.region) + row.result.region
        })

        result.value = rows
      }

      return {
        loading,
        result,
        length,
        done,
        progress,
        duration,
        async onClick() {
          done.value = false
          progress.value = 0
          loading.value = true
          await check()
          loading.value = false
          done.value = true
        }
      }
    }
  }

  modal.setContent(content)
  modal.open()
}

function countryCodeToEmoji(input) {
  if (typeof input !== 'string') return ''

  const letters = input.toUpperCase().match(/[A-Z]/g)
  if (!letters || letters.length < 2) return ''

  const code = letters.slice(0, 2)
  const firstChar = code[0].charCodeAt(0) - 65 + 0x1f1e6
  const secondChar = code[1].charCodeAt(0) - 65 + 0x1f1e6

  return String.fromCodePoint(firstChar) + String.fromCodePoint(secondChar)
}

class CheckResult {
  constructor(name, status, region) {
    this.name = name
    this.status = status
    this.region = region
  }
}

const Checker = {
  bilibili: {
    skip: true,
    async check(name, url) {
      let status, region

      try {
        const { body } = await Plugins.HttpGet(url)
        if (body.code === 0) status = 'Yes'
        else if (body.code === -10403) status = 'No'
        else status = 'Failed'
      } catch (error) {
        status = error.message || error
      }

      return new CheckResult(name, status, region)
    }
  },
  bilibili_china_mainland: {
    name: '哔哩哔哩大陆',
    check() {
      return Checker.bilibili.check(
        this.name,
        'https://api.bilibili.com/pgc/player/web/playurl?avid=82846771&qn=0&type=&otype=json&ep_id=307247&fourk=1&fnver=0&fnval=16&module=bangumi'
      )
    }
  },
  bilibili_hk_mc_tw: {
    name: '哔哩哔哩港澳台',
    check() {
      return Checker.bilibili.check(
        this.name,
        'https://api.bilibili.com/pgc/player/web/playurl?avid=18281381&cid=29892777&qn=0&type=&otype=json&ep_id=183799&fourk=1&fnver=0&fnval=16&module=bangumi'
      )
    }
  },
  chatgpt: {
    skip: true,
    regionPromise: null,
    async fetchRegion() {
      if (!this.regionPromise) {
        this.regionPromise = Plugins.HttpGet('https://chat.openai.com/cdn-cgi/trace')
          .then(({ body }) => body.match(/loc=(\w*)/)?.[1])
          .catch((error) => error.message || error)
      }
      return this.regionPromise
    }
  },
  chatgpt_ios: {
    name: 'ChatGPT iOS',
    async check() {
      let status

      try {
        const { body } = await Plugins.HttpGet('https://ios.chat.openai.com/')
        const bodyLower = JSON.stringify(body).toLowerCase()
        if (bodyLower.includes('you may be connected to a disallowed isp')) {
          status = 'Disallowed ISP'
        } else if (bodyLower.includes('request is not allowed. please try again later.')) {
          status = 'Yes'
        } else if (bodyLower.includes('sorry, you have been blocked')) {
          status = 'Blocked'
        } else {
          status = 'Failed'
        }
      } catch (error) {
        status = error.message || error
      }

      return new CheckResult(this.name, status, await Checker.chatgpt.fetchRegion())
    }
  },
  chatgpt_web: {
    name: 'ChatGPT Web',
    async check() {
      let status = 'Failed'

      try {
        const { body } = await Plugins.HttpGet('https://api.openai.com/compliance/cookie_requirements')
        const bodyLower = JSON.stringify(body).toLowerCase()
        if (bodyLower.toLowerCase().includes('unsupported_country')) status = 'Unsupported Country/Region'
        else status = 'Yes'
      } catch (error) {
        status = error.message || error
      }

      return new CheckResult(this.name, status, await Checker.chatgpt.fetchRegion())
    }
  },
  gemini: {
    name: 'Gemini',
    async check() {
      let status, region

      try {
        const { body } = await Plugins.HttpGet('https://gemini.google.com')
        if (body.includes('45631641,null,true')) status = 'Yes'
        else status = 'No'
        region = body.match(/,2,1,200,"([A-Z]{3})"/)?.[1]
      } catch (error) {
        status = error.message || error
      }

      return new CheckResult(this.name, status, region)
    }
  },
  youtube_premium: {
    name: 'Youtube Premium',
    async check() {
      let status, region

      try {
        const { body } = await Plugins.HttpGet('https://www.youtube.com/premium')
        const bodyLower = body.toLowerCase()
        if (bodyLower.includes('youtube premium is not available in your country')) {
          status = 'No'
        } else if (bodyLower.includes('ad-free')) {
          region = body.match(/id="country-code"[^>]*>([^<]+)</)?.[1]
          status = 'Yes'
        }
      } catch (error) {
        status = error.message || error
      }

      return new CheckResult(this.name, status, region)
    }
  },
  bahamut_anime: {
    name: 'Bahamut Anime',
    UserAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    async check() {
      // TODO: 需要处理下cookie
      try {
        const { body } = await Plugins.HttpGet('https://ani.gamer.com.tw/ajax/getdeviceid.php', {
          'User-Agent': this.UserAgent
        })
        const deviceId = body.match(/"deviceid"\s*:\s*"([^"]+)/)?.[1]
        if (!deviceId) {
          return new CheckResult(this.name, 'Failed', null)
        }
        const { body: body2 } = await Plugins.HttpGet('https://ani.gamer.com.tw/ajax/token.php?adID=89422&sn=37783&device=' + deviceId, {
          'User-Agent': this.UserAgent
        })
        if (!body2.includes('animeSn')) {
          return new CheckResult(this.name, 'No', null)
        }
        const { body: body3 } = await Plugins.HttpGet('https://ani.gamer.com.tw/', {
          'User-Agent': this.UserAgent
        })
        const region = body3.match(/data-geo="([^"]+)/)?.[1]
        return new CheckResult(this.name, 'Yes', region)
      } catch (error) {
        return new CheckResult(this.name, error.message || error, null)
      }
    }
  },
  netflix: {
    name: 'Netflix',
    async check() {
      const result = await Checker.netflix_cdn.check()
      if (result.status === 'Yes') return result

      const url1 = 'https://www.netflix.com/title/81280792'
      const url2 = 'https://www.netflix.com/title/70143836'
      try {
        const [{ status: status1 }, { status: status2 }] = await Promise.all([Plugins.HttpGet(url1), Plugins.HttpGet(url2)])

        if (status1 === 404 && status2 === 404) {
          return new CheckResult(this.name, 'Originals Only', null)
        }
        if (status1 === 403 && status2 === 403) {
          return new CheckResult(this.name, 'No', null)
        }
        if (status1 === 200 || status1 === 301 || status2 === 200 || status2 === 301) {
          try {
            let region = 'US'
            const { headers } = await Plugins.HttpGet('https://www.netflix.com/title/80018499')
            if (headers['Location']) {
              const parts = headers['Location'].split('/')
              if (parts.length >= 4) {
                region = parts[3].split('-')[0] || 'Unknown'
              }
            }
            return new CheckResult(this.name, 'Yes', region)
          } catch (error) {
            throw 'Yes（无法获取区域）'
          }
        }
      } catch (error) {
        return new CheckResult(this.name, error.message || error, null)
      }
    }
  },
  netflix_cdn: {
    name: 'Netflix CDN',
    skip: true,
    async check() {
      let status = 'Failed'
      let region

      try {
        const { status: statusCode, body } = await Plugins.HttpGet(
          'https://api.fast.com/netflix/speedtest/v2?https=true&token=YXNkZmFzZGxmbnNkYWZoYXNkZmhrYWxm&urlCount=5'
        )
        if (statusCode === 403) {
          status = 'No (IP Banned By Netflix)'
        } else if (body.targets) {
          status = 'Yes'
          region = body.targets[0].location?.country
        } else {
          status = 'Unknown'
        }
      } catch (error) {
        status = error.message || error
      }

      return new CheckResult(this.name, status, region)
    }
  },
  disney_plus: {
    name: 'Disney+',
    Token: 'Bearer ZGlzbmV5JmJyb3dzZXImMS4wLjA.Cu56AgSfBTDag5NiRA81oLHkDZfu5L3CKadnefEAY84',
    async check() {
      const { body, status } = await Plugins.HttpPost(
        'https://disney.api.edge.bamgrid.com/devices',
        {
          Authorization: this.Token,
          'Content-Type': 'application/json'
        },
        {
          deviceFamily: 'browser',
          applicationRuntime: 'chrome',
          deviceProfile: 'windows',
          attributes: {}
        }
      )
      if (status === 403) {
        return new CheckResult(this.name, 'No (IP Banned By Disney+)', null)
      }
      const assertion = body.assertion
      if (!assertion) {
        return new CheckResult(this.name, 'Failed', null)
      }

      const { body: body2, status: status2 } = await Plugins.HttpPost(
        'https://disney.api.edge.bamgrid.com/token',
        {
          Authorization: this.Token,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        {
          grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
          latitude: '0',
          longitude: '0',
          platform: 'browser',
          subject_token: assertion,
          subject_token_type: 'urn:bamtech:params:oauth:token-type:device'
        }
      )
      const body2Str = JSON.stringify(body2)
      if (status2 === 403 || body2Str.includes('forbidden-location')) {
        return new CheckResult(this.name, 'No (IP Banned By Disney+)', null)
      }
      const refreshToken = body2.refresh_token || body2Str.match(/"refresh_token"\s*:\s*"([^"]+)/)?.[1]
      if (!refreshToken) {
        return new CheckResult(this.name, 'No (Cannot extract refresh token)', null)
      }

      const { body: body3, status: status3 } = await Plugins.HttpPost(
        'https://disney.api.edge.bamgrid.com/graph/v1/device/graphql',
        {
          Authorization: this.Token,
          'Content-Type': 'application/json'
        },
        {
          query: `mutation refreshToken($input: RefreshTokenInput!) {
            refreshToken(refreshToken: $input) {
              activeSession {
                sessionId
              }
            }
          }`,
          variables: {
            input: {
              refreshToken: refreshToken
            }
          }
        }
      )
      const body3Str = JSON.stringify(body3)
      let region = body3Str.match(/countryCode"\s*:\s*"([^"]+)"/)?.[1]
      if (!region) {
        try {
          const { body, status } = await Plugins.HttpGet('https://disneyplus.com')
          region = body.match(/region"\s*:\s*"([^"]+)"/)?.[1]
        } catch {}
      }
      if (!region) {
        return new CheckResult(this.name, 'No', null)
      }

      const supported = body3Str.match(/"inSupportedLocation"\s*:\s*(true|false)/)?.[1] === 'true'

      const { headers: headers4 } = await Plugins.HttpGet('https://disneyplus.com', undefined, { Redirect: false })
      const redirectUrl = headers4['Location']
      if (redirectUrl.includes('preview') || redirectUrl.includes('unavailable')) {
        return new CheckResult(this.name, 'No', null)
      }

      return new CheckResult(this.name, supported ? 'Yes' : 'No', region)
    }
  },
  prime_video: {
    name: 'Prime Video',
    async check() {
      let status = 'Failed'
      let region

      try {
        const { body } = await Plugins.HttpGet('https://www.primevideo.com')
        region = body.match(/"currentTerritory":"([^"]+)/)?.[1]
        if (body.includes('isServiceRestricted')) {
          status = 'No (Service Not Available)'
        } else {
          status = 'Yes'
        }
      } catch (error) {
        status = error.message || error
      }

      return new CheckResult(this.name, status, region)
    }
  }
}
