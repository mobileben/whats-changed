import * as core from '@actions/core'
import * as github from '@actions/github'
import {mkdirP} from '@actions/io'
import {writeFile} from 'fs'
import {dirname} from 'path'
import {promisify} from 'util'

interface OutputJson {
  all: string[]
  added: string[]
  modified: string[]
  removed: string[]
  renamed: string[]
}

const writeFileAsync = promisify(writeFile)

// debug value to determine if we need to emit logging
let debug = false

async function run(): Promise<void> {
  try {
    const inDebug = core.getInput('debug')
    if (inDebug) {
      debug = JSON.parse(inDebug) as boolean
    }

    let pretty = false
    const inPretty = core.getInput('pretty')
    if (inPretty) {
      pretty = JSON.parse(inPretty) as boolean
    }

    let path: string | null = null
    const inPath = core.getInput('path')
    if (inPath) {
      path = inPath
    }

    const client = github.getOctokit(core.getInput('token', {required: true}))

    const all: string[] = []
    const added: string[] = []
    const modified: string[] = []
    const removed: string[] = []
    const renamed: string[] = []

    const eventName = github.context.eventName

    let base = undefined
    let head = undefined
    let baseOwner = undefined
    let headOwner = undefined

    if (eventName === 'pull_request') {
      base = github.context.payload.pull_request?.base.sha
      head = github.context.payload.pull_request?.head.sha
      baseOwner = github.context.payload.pull_request?.base.user.login
      headOwner = github.context.payload.pull_request?.head.user.login
    } else if (eventName === 'push') {
      base = github.context.payload.before
      head = github.context.payload.after
      baseOwner = github.context.repo.owner
      headOwner = github.context.repo.owner
    }

    if (base && head && baseOwner && headOwner) {
      const basehead = `${baseOwner}:${base}...${headOwner}:${head}`
      const response = await client.rest.repos.compareCommitsWithBasehead({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        basehead
      })

      if (response && response.data.files) {
        if (response.status === 200) {
          //  Check to ensure head is ahead
          if (response.data.status === 'ahead') {
            for (const file of response.data.files) {
              const filename = file.filename

              logDebug(`${filename} $(file.status}`)
              all.push(filename)
              switch (file.status) {
                case 'added':
                  added.push(filename)
                  break
                case 'modified':
                  modified.push(filename)
                  break
                case 'removed':
                  removed.push(filename)
                  break
                case 'renamed':
                  renamed.push(filename)
                  break
                default:
              }
            }
          } else {
            core.setFailed('${head} is behind ${base}')
          }
        } else {
          core.setFailed(`GitHub API failed compare failed.`)
        }
      }
    }

    const json: OutputJson = {
      all,
      added,
      modified,
      removed,
      renamed
    }

    const out = populateOutput(json, pretty)
    if (path) {
      const targetDir = dirname(path)
      await mkdirP(targetDir)
      await writeFileAsync(path, out)
    }
  } catch (error) {
    core.setFailed(error.message)
  }
}

function populateOutput(json: OutputJson, pretty: boolean): string {
  const outJson = pretty ? JSON.stringify(json, null, 4) : JSON.stringify(json)
  core.setOutput('json', outJson)
  core.setOutput('all', JSON.stringify(json.all))
  core.setOutput('added', JSON.stringify(json.added))
  core.setOutput('modified', JSON.stringify(json.modified))
  core.setOutput('removed', JSON.stringify(json.removed))
  core.setOutput('renamed', JSON.stringify(json.renamed))
  core.setOutput('all-count', json.all.length)
  core.setOutput('added-count', json.added.length)
  core.setOutput('modified-count', json.modified.length)
  core.setOutput('removed-count', json.removed.length)
  core.setOutput('renamed-count', json.renamed.length)
  return outJson
}

function logDebug(msg: string): void {
  if (debug) {
    core.info(msg)
  }
}

run()
