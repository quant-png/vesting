// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title TokenVesting
 * @dev A contract for vesting ERC20 tokens over time with a cliff period.
 */
contract TokenVesting is ReentrancyGuard, Pausable, Ownable {
    IERC20 public immutable token;
    
    struct VestingData {
        uint128 startTime;    // 16 bytes
        uint128 totalLocked;  // 16 bytes
        uint128 totalClaimed; // 16 bytes
        bool initialized;     // 1 bit
    }
    
    VestingData private _data;

    uint256 private constant VESTING_DURATION = 360 days;
    uint256 private constant CLIFF_DURATION = 30 days;
    uint256 private constant VESTING_PERIODS = 12;

    event TokensDeposited(address indexed depositor, uint256 amount, uint256 timestamp, bool isInitialized);
    event TokensClaimed(address indexed claimer, uint256 amount, uint256 timestamp);
    event EmergencyWithdraw(address indexed to, uint256 amount);

    modifier onlyInitialized() {
        require(_data.initialized, "Vesting not initialized");
        _;
    }

    modifier onlyNotInitialized() {
        require(!_data.initialized, "Vesting already initialized");
        _;
    }

    /**
     * @dev Constructor sets the token address.
     * @param _token The address of the ERC20 token to be vested.
     */
    constructor(address _token) Ownable(msg.sender) {
        require(_token != address(0), "Invalid token address");
        token = IERC20(_token);
    }

    /**
     * @dev Deposits tokens into the vesting contract.
     * @param amount The amount of tokens to deposit.
     */
    function depositTokens(uint256 amount) 
        external 
        onlyOwner 
        onlyNotInitialized 
        nonReentrant 
        whenNotPaused 
    {
        require(amount > 0, "Cannot deposit 0 tokens");
        require(amount <= type(uint128).max, "Amount too large");

        _data.totalLocked = uint128(amount);
        _data.startTime = uint128(block.timestamp);
        _data.initialized = true;
        
        require(token.transferFrom(msg.sender, address(this), amount),
            "Token transfer failed");
        
        emit TokensDeposited(msg.sender, amount, block.timestamp, _data.initialized);
    }

    /**
     * @dev Claims vested tokens.
     */
    function claimTokens() 
        external 
        onlyOwner 
        onlyInitialized 
        nonReentrant 
        whenNotPaused 
    {
        uint256 claimableAmount = calculateClaimable();
        require(claimableAmount > 0, "No tokens available to claim");

        _data.totalClaimed += uint128(claimableAmount);
        
        require(token.transfer(owner(), claimableAmount),
            "Token transfer failed");
        
        emit TokensClaimed(msg.sender, claimableAmount, block.timestamp);
    }

    /**
     * @dev Calculates the amount of tokens that can be claimed.
     * @return The amount of tokens that can be claimed.
     */
    function calculateClaimable() public view returns (uint256) {
        if (!_data.initialized || block.timestamp < _data.startTime + CLIFF_DURATION) {
            return 0;
        }

        uint256 elapsedTime = block.timestamp - _data.startTime;
        if (elapsedTime > VESTING_DURATION) {
            return _data.totalLocked - _data.totalClaimed;
        }

        // Calculate how many 30-day periods have passed
        uint256 vestedPeriods = elapsedTime / CLIFF_DURATION;
        
        // Ensure we don't exceed the total number of periods
        uint256 finalVestedPeriods = vestedPeriods >= VESTING_PERIODS ? VESTING_PERIODS : vestedPeriods;

        // Calculate tokens per period
        uint256 tokensPerPeriod = _data.totalLocked / VESTING_PERIODS;
        
        // Calculate total vested tokens
        uint256 totalVested = tokensPerPeriod * finalVestedPeriods;
        
        // Return claimable token amount
        return totalVested > _data.totalClaimed ? totalVested - _data.totalClaimed : 0;
    }

    /**
     * @dev Returns the remaining tokens in the contract.
     * @return The amount of remaining tokens.
     */
    function remainingTokens() external view returns (uint256) {
        return token.balanceOf(address(this));
    }

    /**
     * @dev Withdraws surplus tokens from the contract.
     */
    function withdrawSurplus() 
        external 
        onlyOwner 
        onlyInitialized 
        nonReentrant 
        whenNotPaused 
    {
        uint256 available = token.balanceOf(address(this)) - 
            (_data.totalLocked - _data.totalClaimed);
        require(available > 0, "No surplus tokens");
        token.transfer(owner(), available);
    }

    // Emergency functions
    /**
     * @dev Pauses the contract.
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @dev Unpauses the contract.
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @dev Emergency withdraws all tokens from the contract.
     */
    function emergencyWithdraw() external onlyOwner whenPaused {
        uint256 balance = token.balanceOf(address(this));
        require(balance > 0, "No tokens to withdraw");
        token.transfer(owner(), balance);
        emit EmergencyWithdraw(owner(), balance);
    }

    // View functions
    /**
     * @dev Returns the start time of the vesting.
     * @return The start time.
     */
    function startTime() external view returns (uint256) {
        return _data.startTime;
    }

    /**
     * @dev Returns the total amount of tokens locked.
     * @return The total locked amount.
     */
    function totalLocked() external view returns (uint256) {
        return _data.totalLocked;
    }

    /**
     * @dev Returns the total amount of tokens claimed.
     * @return The total claimed amount.
     */
    function totalClaimed() external view returns (uint256) {
        return _data.totalClaimed;
    }

    /**
     * @dev Returns whether the vesting is initialized.
     * @return True if initialized, false otherwise.
     */
    function initialized() external view returns (bool) {
        return _data.initialized;
    }

    /**
     * @dev Returns whether the vesting is initialized.
     * @return True if initialized, false otherwise.
     */
    function vestingDuration() external pure returns (uint256) {
        return CLIFF_DURATION;
    }
}