const utils = require('@gnosis.pm/safe-contracts/test/utils')
const ethUtil = require('ethereumjs-util')
const ethAbi = require('ethereumjs-abi')

const CreateAndAddModules = artifacts.require("./CreateAndAddModules.sol")
const GnosisSafe = artifacts.require("./GnosisSafe.sol")
const ProxyFactory = artifacts.require("./ProxyFactory.sol")
const TopUpModule = artifacts.require("./TopUpModule.sol")
const TestToken = artifacts.require("./TestToken.sol")
const TestCompound = artifacts.require("./TestCompound.sol")

contract('TopUpModule', function(accounts) {
    let gnosisSafe
    let proxyFactory
    let createAndAddModules
    let moduleMasterCopy
    let lw

    const ADDRESS_0 = "0x0000000000000000000000000000000000000000"
    const DELEGATE = 1

    const GnosisSafeFactory = {
        at: function(address) {
            return { at: async function() { return GnosisSafe.at(address) } }
        }
    }
    
    const deployModule = async function(rules) {
        let moduleData = await moduleMasterCopy.contract.methods.setup(rules).encodeABI()
        let proxyFactoryData = await proxyFactory.contract.methods.createProxy(moduleMasterCopy.address, moduleData).encodeABI()
        let modulesCreationData = utils.createAndAddModulesData([proxyFactoryData])
        let createAndAddModulesData = createAndAddModules.contract.methods.createAndAddModules(proxyFactory.address, modulesCreationData).encodeABI()

        let nonce = await gnosisSafe.nonce()
        let transactionHash = await gnosisSafe.getTransactionHash(createAndAddModules.address, 0, createAndAddModulesData, DELEGATE, 0, 0, 0, ADDRESS_0, ADDRESS_0, nonce)
        let sigs = utils.signTransaction(lw, [lw.accounts[0], lw.accounts[1]], transactionHash)
        utils.logGasUsage(
            'execTransaction enable module',
            await gnosisSafe.execTransaction(
                createAndAddModules.address, 0, createAndAddModulesData, DELEGATE, 0, 0, 0, ADDRESS_0, ADDRESS_0, sigs
            )
        )
    }


    beforeEach(async function () {
        // Create lightwallet
        lw = await utils.createLightwallet()

        // Create Master Copies
        proxyFactory = await ProxyFactory.new()
        createAndAddModules = await CreateAndAddModules.new()
        let gnosisSafeMasterCopy = await GnosisSafe.new()
        console.log("gnosisSafeMasterCopy", gnosisSafeMasterCopy.address)
        moduleMasterCopy = await TopUpModule.new()
        // Initialize safe master copy with accounts[0] and accounts[1] as owners and 2 required confirmations
        await gnosisSafeMasterCopy.setup([accounts[0], accounts[1]], 2, ADDRESS_0, "0x")

        // Initialize safe proxy with lightwallet accounts as owners and also accounts[1], note that only lightwallet accounts can sign messages without prefix
        let gnosisSafeData = await gnosisSafeMasterCopy.contract.methods.setup([lw.accounts[0], lw.accounts[1], accounts[1]], 2, ADDRESS_0, "0x").encodeABI()
        gnosisSafe = await utils.getParamFromTxEvent(
            await proxyFactory.createProxy(gnosisSafeMasterCopy.address, gnosisSafeData),
            'ProxyCreation', 'proxy', proxyFactory.address, GnosisSafeFactory, 'create Gnosis Safe',
        ).at()
    })

    it('execute only if min transfer amount is reached', async () => {
        const sourceToken = await TestToken.new({from: accounts[0]})
        const mintToken = await TestCompound.new(sourceToken.address)
        await deployModule([{ 
            sourceToken: sourceToken.address,
            mintToken: mintToken.address,
            minTransferAmount: 10000,
            maxTriggerReward: 0,
            noTransferAmount: 0
        }])
        let modules = await gnosisSafe.getModules()
        let topUpModule = await TopUpModule.at(modules[0])
        assert.equal(await topUpModule.manager(), gnosisSafe.address)
        console.log(await topUpModule.listRules())
        await sourceToken.transfer(gnosisSafe.address, 1000, {from: accounts[0]}) 
        assert.equal(await sourceToken.balanceOf(gnosisSafe.address), 1000)
        assert.equal(await mintToken.balanceOf(gnosisSafe.address), 0)
        utils.assertRejects(topUpModule.executeTopUp(0, 0), "Should not allow with too low balance")
        await sourceToken.transfer(gnosisSafe.address, 9000, {from: accounts[0]}) 
        utils.assertRejects(topUpModule.executeTopUp(0, 1), "Should not allow with reward")
        utils.logGasUsage("Execute topUp without reward", await topUpModule.executeTopUp(0, 0))
        assert.equal(await mintToken.balanceOf(gnosisSafe.address), 10000)
        assert.equal(await sourceToken.balanceOf(gnosisSafe.address), 0)
    })

    it('execute with reward', async () => {
        const sourceToken = await TestToken.new({from: accounts[0]})
        const mintToken = await TestCompound.new(sourceToken.address)
        await deployModule([{ 
            sourceToken: sourceToken.address,
            mintToken: mintToken.address,
            minTransferAmount: 10000,
            maxTriggerReward: 100,
            noTransferAmount: 0
        }])
        let modules = await gnosisSafe.getModules()
        let topUpModule = await TopUpModule.at(modules[0])
        assert.equal(await topUpModule.manager(), gnosisSafe.address)
        console.log(await topUpModule.listRules())
        await sourceToken.transfer(gnosisSafe.address, 1000, {from: accounts[0]}) 
        assert.equal(await sourceToken.balanceOf(gnosisSafe.address), 1000)
        assert.equal(await mintToken.balanceOf(gnosisSafe.address), 0)
        utils.assertRejects(topUpModule.executeTopUp(0, 0), "Should not allow with too low balance")
        await sourceToken.transfer(gnosisSafe.address, 9000, {from: accounts[0]}) 
        utils.assertRejects(topUpModule.executeTopUp(0, 101), "Should not allow with too high reward")
        utils.logGasUsage("Execute topUp with reward", await topUpModule.executeTopUp(0, 100, {from: accounts[2]}))
        assert.equal(await mintToken.balanceOf(gnosisSafe.address), 9900)
        assert.equal(await sourceToken.balanceOf(gnosisSafe.address), 0)
        assert.equal(await sourceToken.balanceOf(accounts[2]), 100)
    })

    it('execute with reward and noTransferAmount', async () => {
        const sourceToken = await TestToken.new({from: accounts[0]})
        const mintToken = await TestCompound.new(sourceToken.address)
        await deployModule([{ 
            sourceToken: sourceToken.address,
            mintToken: mintToken.address,
            minTransferAmount: 10000,
            maxTriggerReward: 100,
            noTransferAmount: 100
        }])
        let modules = await gnosisSafe.getModules()
        let topUpModule = await TopUpModule.at(modules[0])
        assert.equal(await topUpModule.manager(), gnosisSafe.address)
        console.log(await topUpModule.listRules())
        await sourceToken.transfer(gnosisSafe.address, 1000, {from: accounts[0]}) 
        assert.equal(await sourceToken.balanceOf(gnosisSafe.address), 1000)
        assert.equal(await mintToken.balanceOf(gnosisSafe.address), 0)
        utils.assertRejects(topUpModule.executeTopUp(0, 0), "Should not allow with too low balance")
        await sourceToken.transfer(gnosisSafe.address, 9000, {from: accounts[0]}) 
        utils.assertRejects(topUpModule.executeTopUp(0, 101), "Should not allow with too high reward")
        utils.logGasUsage("Execute topUp with reward", await topUpModule.executeTopUp(0, 100, {from: accounts[2]}))
        assert.equal(await mintToken.balanceOf(gnosisSafe.address), 9800)
        assert.equal(await sourceToken.balanceOf(gnosisSafe.address), 100)
        assert.equal(await sourceToken.balanceOf(accounts[2]), 100)
    })
})