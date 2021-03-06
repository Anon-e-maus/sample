const {expect} = require('chai');
const {BN, time, expectRevert} = require('@openzeppelin/test-helpers');
const {accounts, contract, web3} = require('@openzeppelin/test-environment');

const Token = contract.fromArtifact('Token');
const MockUniswapV2PairTrade = contract.fromArtifact('MockUniswapV2PairTrade');
const MockAggregatorV3Interface = contract.fromArtifact('MockAggregatorV3Interface');
const MockBackingAsset = contract.fromArtifact('MockBackingAsset');
const MockHybridOracle = contract.fromArtifact('MockHybridOracle');
const DECIMAL_DIFF = new BN(10).pow(new BN(0));
const EPSILON = new BN('10000000000000000').mul(DECIMAL_DIFF); //0.01 tolerance on the ratio

const uint112s = (time, priceNum = 1, priceDen = 1) =>
    new BN(priceNum).mul(new BN(2).pow(new BN(112))).divn(priceDen).div(DECIMAL_DIFF).muln(time)

describe('Chainlink/Uniswap HybridOracle Implementation', () => {
    it('should only allow treasury and DAO to set the parent Hybrid Oracle address', async () => {
        await expectRevert(this.oracle.setOraclePoolAddress(mockDaoAddress, {from: userA}),
            "Mock_Oracle: Not Treasury or DAO"
        )

        await expectRevert(this.oracle.setOraclePoolAddress(mockDaoAddress, {from: userB}),
            "Mock_Oracle: Not Treasury or DAO"
        )

        await this.oracle.setDaoAddress(userA, {from: mockDaoAddress})
        await this.oracle.setTreasuryAddress(userB, {from: mockDaoAddress})

        await this.oracle.setOraclePoolAddress(mockDaoAddress, {from: userA})
        await this.oracle.setOraclePoolAddress(mockDaoAddress, {from: userB})

        await expectRevert(this.oracle.setOraclePoolAddress(mockDaoAddress, {from: mockDaoAddress}),
            "Mock_Oracle: Not Treasury or DAO"
        )
    })

    it('should not allow the Hybrid Oracle address to be set to null', async () => {
        await expectRevert(this.oracle.setOraclePoolAddress('0x0000000000000000000000000000000000000000', {from: mockDaoAddress}),
            "Mock_Oracle: Hybrid Oracle cannot be null"
        )
    })

    it('should only allow the Hybrid Oracle to call capture', async () => {
        await this.oracle.setOraclePoolAddress(userB, {from: mockDaoAddress})

        await expectRevert(this.oracle.capture({from: userA}),
            "Mock_Oracle: Not Hybrid Oracle"
        )

        await this.oracle.capture({from: userB})
    })

    it('should return the default price ratio if not initialized and no liquidity present', async () => {
        await lastCaptureAndAssert({ratio: 1, valid: false},
            'It should initialzed with the default ratio/validity without any interactions'
        )

        await captureAndAssert({ratio: 1, valid: false},
            'Returning default price ratio as no liquidity to price against'
        )

        await assertOracleState({isInitialized: false, cumulative: 0, timestamp: 0, reserve: 0},
            'Oracle should not currently be initialized'
        )

        await captureAndAssert({ratio: 1, valid: false},
            'Should still be returning the default price ratio'
        )

        await assertOracleState({isInitialized: false, cumulative: 0, timestamp: 0, reserve: 0},
            'Oracle should still not be initialized'
        )
    })

    it('should initialize and return the default price ratio if liquidity is present', async () => {
        await captureAndAssert({ratio: 1, valid: false},
            'Returning default price ratio as no liquidity to price against'
        )

        const timestampOfFirstTrade = await simulateTrade({tokenBalance: 10, backingAssetBalance: 12})

        await nextEpoch()
        await captureAndAssert({ratio: 1, valid: false},
            'Should now be initialized, but still returning the default price on first pass'
        )

        await assertOracleState({isInitialized: true, cumulative: 0, timestamp: timestampOfFirstTrade, reserve: bnBackingAsset(12)},
            'Capture performed previously over liquidity, so reserve, timestamp, and isInitialized should reflect the initialization'
        )
    });

    it('should be initialized and return a valid price on next capture after initialization', async () => {
        const initial = await initialize({tokenBalance: 10, backingAssetBalance: 12});
        await captureAndAssert({ratio: 1.2, valid: true},
            'On next capture, valid price ratio should be reported'
        )

        await nextEpoch()
        const last = await captureAndAssert({ratio: 1.2, valid: true},
            'The correct price should still be returned without change'
        )
        const cumulative = uint112s(last.sub(initial).toNumber(), 12, 10)

        await assertOracleState(
            {isInitialized: true, cumulative, timestamp: last, reserve: bnBackingAsset(12)},
            'As Oracle is initialized, the cumulative price of token should now be updated'
        )
    })

    it('should return a ratio of greater than current price if buying occurs and backing asset is equal to price of token', async () => {
        const initial = await initialize({tokenBalance: 10, backingAssetBalance: 13})
        await captureAndAssert({ratio: 1.3, valid: true},
            'The initial price ratio should be reported'
        )

        const middle = await simulateTrade({tokenBalance: 10, backingAssetBalance: 15})
        await nextEpoch();
        await simulateTrade({tokenBalance: 10, backingAssetBalance: 15})
        await nextEpoch();
        await simulateTrade({tokenBalance: 10, backingAssetBalance: 15})
        await nextEpoch();

        const last = await captureAndAssert({ratio: 1.5, valid: true},
            'The increased price ratio should be reported'
        )

        const firstCumulativeRange = uint112s(middle.sub(initial).toNumber(), 13, 10)
        const increasedPriceCumulativeRange = uint112s(last.sub(middle).toNumber(), 15, 10)
        const cumulative = increasedPriceCumulativeRange.add(firstCumulativeRange)

        await assertOracleState(
            {isInitialized: true, cumulative, timestamp: last, reserve: bnBackingAsset(15)},
            'Updated price and timing info should be reflected along with a cumulative which encapsulates both price points'
        )
    })

    it('should return a ratio of less than 1 if selling occurs and backing asset is equal to price of token', async () => {
        const initial = await initialize({tokenBalance: 16, backingAssetBalance: 10})
        await captureAndAssert({ratio: 0.625, valid: true},
            'The initial price ratio should be reported'
        )

        const middle = await simulateTrade({tokenBalance: 20, backingAssetBalance: 10})
        await nextEpoch();
        await simulateTrade({tokenBalance: 20, backingAssetBalance: 10})
        await nextEpoch();
        await simulateTrade({tokenBalance: 20, backingAssetBalance: 10})
        await nextEpoch();

        const last = await captureAndAssert({ratio: 0.5, valid: true},
            'The decreased price ratio should be reported'
        )

        const firstCumulativeRange = uint112s(middle.sub(initial).toNumber(), 10, 16)
        const decreasedPriceCumulativeRange = uint112s(last.sub(middle).toNumber(), 10, 20)
        const cumulative = decreasedPriceCumulativeRange.add(firstCumulativeRange)

        await assertOracleState(
            {isInitialized: true, cumulative, timestamp: last, reserve: bnBackingAsset(10)},
            'Updated price and timing info should be reflected in Oracle state'
        )
    });

    it('should return a ratio greater than the current if no buying occurs and backing asset increases in price', async () => {
        await simulateBackingAssetPriceChange({newPrice: 1000e8, newDecimals: 8})
        const initialTimestamp = await initialize({tokenBalance: 10, backingAssetBalance: 15})
        await captureAndAssert({ratio: 1.5, valid: true},
            'The initial price ratio should be reported'
        )

        await nextEpoch();

        await simulateBackingAssetPriceChange({newPrice: 2000e8, newDecimals: 8})

        const lastTimestamp = await captureAndAssert({ratio: 3, valid: true},
            'The token in the pool should now be worth more via appreciation of the underlying asset'
        )

        const cumulative = uint112s(lastTimestamp.sub(initialTimestamp).toNumber(), 15, 10)

        await assertOracleState(
            {isInitialized: true, cumulative, timestamp: lastTimestamp, reserve: bnBackingAsset(15)},
            'Cumulative price should remain representative of the underlying pool only'
        )
    })

    it('should return a ratio less than the current if no selling occurs and backing asset decreases in price', async () => {
        await simulateBackingAssetPriceChange({newPrice: 2000e8, newDecimals: 8})
        const initialTimestamp = await initialize({tokenBalance: 10, backingAssetBalance: 15})
        await captureAndAssert({ratio: 3, valid: true},
            'The initial price ratio should be reported'
        )

        await nextEpoch();

        await simulateBackingAssetPriceChange({newPrice: 1000e8, newDecimals: 8})

        const lastTimestamp = await captureAndAssert({ratio: 1.5, valid: true},
            'The token in the pool should now be worth more via appreciation of the underlying asset'
        )

        const cumulative = uint112s(lastTimestamp.sub(initialTimestamp).toNumber(), 15, 10)

        await assertOracleState(
            {isInitialized: true, cumulative, timestamp: lastTimestamp, reserve: bnBackingAsset(15)},
            'Cumulative price should remain representative of the underlying pool only'
        )
    })

    it('should return a ratio greater than the current if no buying occurs and price of token decreases', async () => {
        await simulateTokenPriceChange({newPrice: 2000e8, newDecimals: 8})
        const initialTimestamp = await initialize({tokenBalance: 10, backingAssetBalance: 15})
        await captureAndAssert({ratio: 0.75, valid: true},
            'The initial price ratio should be reported'
        )

        await nextEpoch();

        await simulateTokenPriceChange({newPrice: 1000e8, newDecimals: 8})

        const lastTimestamp = await captureAndAssert({ratio: 1.5, valid: true},
            'The ratio should increase, as the price of token in the real world has decreased in price relative to our uniswap pool'
        )

        const cumulative = uint112s(lastTimestamp.sub(initialTimestamp).toNumber(), 15, 10)

        await assertOracleState(
            {isInitialized: true, cumulative, timestamp: lastTimestamp, reserve: bnBackingAsset(15)},
            'Cumulative price should remain representative of the underlying pool only'
        )
    })

    it('should return a ratio less than the current if no selling occurs and price of token increases', async () => {
        await simulateTokenPriceChange({newPrice: 1000e8, newDecimals: 8})
        const initialTimestamp = await initialize({tokenBalance: 10, backingAssetBalance: 15})
        await captureAndAssert({ratio: 1.5, valid: true},
            'The initial price ratio should be reported'
        )

        await nextEpoch();

        await simulateTokenPriceChange({newPrice: 2000e8, newDecimals: 8})

        const lastTimestamp = await captureAndAssert({ratio: 0.75, valid: true},
            'The ratio decrease, as the price of token in the real world has increases in price relative to our uniswap pool'
        )

        const cumulative = uint112s(lastTimestamp.sub(initialTimestamp).toNumber(), 15, 10)

        await assertOracleState(
            {isInitialized: true, cumulative, timestamp: lastTimestamp, reserve: bnBackingAsset(15)},
            'Cumulative price should remain representative of the underlying pool only'
        )
    })

    it('should signify invalid if reserves of the backing asset drop too low within the pool', async () => {
        await captureAndAssert({ratio: 1, valid: false},
            'Returning default price ratio as no liquidity to price against'
        )

        await simulateTrade({tokenBalance: 10, backingAssetBalance: 12})
        await nextEpoch()
        await captureAndAssert({ratio: 1, valid: false},
            'Should now be initialized, but still returning the default price on first pass'
        )

        await nextEpoch()
        await captureAndAssert({ratio: 1.2, valid: true},
            'Should now return a valid ratio against the available liquidity'
        )

        await simulateTrade({tokenBalance: 10, backingAssetBalance: 0.5})
        await nextEpoch()
        await simulateTrade({tokenBalance: 10, backingAssetBalance: 0.5})
        await nextEpoch()
        await captureAndAssert({ratio: 0.05, valid: false},
            'Should now return invalid, and the default price ratio as liquidity has been removed'
        )
    });

    it('should work as expected with price feeds of a differing number of decimals', async () => {
        await setup({backingAssetDecimals: 18, tokenFeedDecimals: 8, backingFeedDecimals: 8, reserveMinimum: 1e18})
        await initializeBn({tokenBalance: new BN(100e18.toString()), backingAssetBalance: new BN(150e18.toString())})
        await simulateBackingAssetPriceChange({newPrice: 1000, newDecimals: 0})
        await simulateTokenPriceChange({newPrice: 1000e8, newDecimals: 8})
        await captureAndAssert({ratio: 1.5, valid: true},
            'The initial price ratio should be reported'
        )

        await setup({backingAssetDecimals: 6, tokenFeedDecimals: 5, backingFeedDecimals: 0, reserveMinimum: 1e6})
        await initializeBn({tokenBalance: new BN(100e18.toString()), backingAssetBalance: new BN(150e6.toString())})
        await simulateBackingAssetPriceChange({newPrice: 1000, newDecimals: 0})
        await simulateTokenPriceChange({newPrice: 1000e5, newDecimals: 5})
        await captureAndAssert({ratio: 1.5, valid: true},
            'The initial price ratio should still be reported'
        )

        await setup({backingAssetDecimals: 10, tokenFeedDecimals: 10, backingFeedDecimals: 4, reserveMinimum: 1e10})
        await initializeBn({tokenBalance: new BN(10e18.toString()), backingAssetBalance: new BN(15e10.toString())})
        await simulateBackingAssetPriceChange({newPrice: 1000e4, newDecimals: 4})
        await simulateTokenPriceChange({newPrice: 1000e10, newDecimals: 10})
        await captureAndAssert({ratio: 1.5, valid: true},
            'The initial price ratio should still be reported (ratio is not changing, only decimals of various price feeds/the asset backing ERC20)'
        )
    })

    const [mockDaoAddress, userA, userB] = accounts

    const bnRatio = (n) =>
        new BN(n * 1000).mul(new BN(1e15.toString()))

    const bnBackingAsset = (n) => bnRatio(n);

    const lastCapture = async () => {
        const result = await this.oracle.lastCapture();
        const price = result[0].value;
        const valid = result[1];
        return {actualPrice: price, actualValid: valid};
    }

    const simulateTrade = async ({tokenBalance, backingAssetBalance}) => {
        await this.amm.simulateTrade(
            new BN(tokenBalance * 100).mul(new BN(10).pow(new BN(16))),
            new BN(backingAssetBalance * 100).mul(new BN(10).pow(new BN(16))))

        return await time.latest()
    }

    const simulateBackingAssetPriceChange = async ({newPrice, newDecimals}) => {
        await this.backingAssetOracle.setLatestPrice(newPrice)
        await this.backingAssetOracle.setDecimals(newDecimals)
    }

    const simulateTokenPriceChange = async ({newPrice, newDecimals}) => {
        await this.tokenOracle.setLatestPrice(newPrice)
        await this.tokenOracle.setDecimals(newDecimals)
    }

    const capture = async () => {
        await this.oracle.capture({from: mockDaoAddress})
        return time.latest();
    }

    const lastCaptureAndAssert = async ({ratio, valid}, reason) => {
        const {actualPrice, actualValid} = await lastCapture()
        expect(actualPrice).to.be.bignumber.closeTo(bnRatio(ratio), EPSILON, 'price mismatch' + (reason ? ': ' + reason : ''))
        expect(actualValid).to.be.equal(valid, "'valid' mismatch" + (reason ? ': ' + reason : ''))
    }

    const captureAndAssert = async ({ratio, valid}, reason) => {
        const timeOfCapture = await capture()
        const {actualPrice, actualValid} = await lastCapture()
        expect(actualPrice).to.be.bignumber.closeTo(bnRatio(ratio), EPSILON, 'price mismatch' + (reason ? ': ' + reason : ''))
        expect(actualValid).to.be.equal(valid, "'valid' mismatch" + (reason ? ': ' + reason : ''))
        return timeOfCapture;
    }

    const assertOracleState = async ({isInitialized, cumulative, timestamp, reserve}, reason) => {
        expect(await this.oracle.isInitialized()).to.be.equal(isInitialized, 'isInitialized mismatch' + (reason ? ': ' + reason : ''))
        expect(await this.oracle.timestamp()).to.be.bignumber.equal(new BN(timestamp), 'timestamp mismatch' + (reason ? ': ' + reason : ''))
        expect(await this.oracle.cumulative()).to.be.bignumber.equal(new BN(cumulative), 'cumulative mismatch' + (reason ? ': ' + reason : ''))
        expect(await this.oracle.reserve()).to.be.bignumber.equal(new BN(reserve), 'reserve mismatch' + (reason ? ': ' + reason : ''))
    }

    const nextEpoch = async () => {
        await time.increase(21600)
        return await time.latest()
    }

    const initialize = async (initialReserves) => {
        await simulateTrade(initialReserves)
        const timestampOfFirstTrade = await time.latest();
        await nextEpoch()
        await capture()
        return timestampOfFirstTrade
    }

    const initializeBn = async ({tokenBalance, backingAssetBalance}) => {
        await this.amm.simulateTrade(tokenBalance, backingAssetBalance)
        const timestampOfFirstTrade = await time.latest();
        await nextEpoch()
        await capture()
        return timestampOfFirstTrade
    }

    const setup = async ({backingAssetDecimals, backingFeedDecimals, tokenFeedDecimals, reserveMinimum}) => {
        this.token = await Token.new({from: mockDaoAddress})
        this.mockBackingAsset = await MockBackingAsset.new(backingAssetDecimals, {from: mockDaoAddress})
        this.amm = await MockUniswapV2PairTrade.new(this.token.address, this.mockBackingAsset.address, {from: mockDaoAddress})

        const initialPrice = 1000e8
        this.tokenOracle = await MockAggregatorV3Interface.new(tokenFeedDecimals, initialPrice, {from: mockDaoAddress})
        this.backingAssetOracle = await MockAggregatorV3Interface.new(backingFeedDecimals, initialPrice, {from: mockDaoAddress})

        this.oracle = await MockHybridOracle.new(
            this.amm.address,
            this.token.address,
            this.backingAssetOracle.address,
            this.tokenOracle.address,
            web3.utils.stringToHex("Mock_Oracle"),
            reserveMinimum.toString(),
            {from: mockDaoAddress, gas: 8000000}
        )

        await this.oracle.setOraclePoolAddress(mockDaoAddress, {from: mockDaoAddress})
    }

    const defaultParams = {backingAssetDecimals: 18, tokenFeedDecimals: 8, backingFeedDecimals: 8, reserveMinimum: 1e18}
    beforeEach(async () => await setup(defaultParams))
});
