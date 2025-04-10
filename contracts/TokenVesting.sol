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
        uint128 vestingDuration; // 16 bytes
        uint128 cliffDuration;   // 16 bytes
        uint8 vestingPeriods;    // 1 byte
        bool initialized;     // 1 bit
    }
    
    VestingData private _data;

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
     * @dev Constructor sets the token address and default vesting parameters.
     * @param _token The address of the ERC20 token to be vested.
     */
    constructor(address _token) Ownable(msg.sender) {
        require(_token != address(0), "Invalid token address");
        token = IERC20(_token);
        
        // Set default vesting parameters
        _data.vestingDuration = uint128(360 days);
        _data.cliffDuration = uint128(30 days);
        _data.vestingPeriods = 12;
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
        if (!_data.initialized || block.timestamp < _data.startTime + _data.cliffDuration) {
            return 0;
        }

        uint256 elapsedTime = block.timestamp - _data.startTime;
        if (elapsedTime > _data.vestingDuration) {
            return _data.totalLocked - _data.totalClaimed;
        }

        uint256 vestedPeriods = elapsedTime / _data.cliffDuration;
        uint256 finalVestedPeriods = vestedPeriods >= _data.vestingPeriods ? _data.vestingPeriods : vestedPeriods;

        uint256 totalVested = (_data.totalLocked * finalVestedPeriods) / _data.vestingPeriods;
        
        return totalVested > _data.totalClaimed ? totalVested - _data.totalClaimed : 0;
    }

    /**
     * @dev Calculates the amount of tokens that can be claimed at a specific timestamp.
     * @param _timestamp The timestamp to check
     * @return The amount of tokens that can be claimed at the specified timestamp.
     */
    function calculateClaimableAt(uint256 _timestamp) public view returns (uint256) {
        if (!_data.initialized || _timestamp < _data.startTime + _data.cliffDuration) {
            return 0;
        }

        uint256 elapsedTime = _timestamp - _data.startTime;
        if (elapsedTime > _data.vestingDuration) {
            return _data.totalLocked - _data.totalClaimed;
        }

        uint256 vestedPeriods = elapsedTime / _data.cliffDuration;
        uint256 finalVestedPeriods = vestedPeriods >= _data.vestingPeriods ? _data.vestingPeriods : vestedPeriods;

        uint256 totalVested = (_data.totalLocked * finalVestedPeriods) / _data.vestingPeriods;
        
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
     * @dev Returns the vesting progress as a percentage (0-100).
     * @return The percentage of tokens that have been vested.
     */
    function getVestingProgress() public view returns (uint256) {
        if (!_data.initialized) return 0;
        
        uint256 elapsedTime = block.timestamp - _data.startTime;
        if (elapsedTime < _data.cliffDuration) return 0;
        if (elapsedTime >= _data.vestingDuration) return 100;

        uint256 vestedPeriods = elapsedTime / _data.cliffDuration;
        uint256 finalVestedPeriods = vestedPeriods >= _data.vestingPeriods ? _data.vestingPeriods : vestedPeriods;
        
        return (finalVestedPeriods * 100) / _data.vestingPeriods;
    }

    /**
     * @dev Returns the timestamp of the next vesting period.
     * @return The timestamp of the next vesting period, or 0 if all tokens are vested.
     */
    function getNextVestingTime() public view returns (uint256) {
        if (!_data.initialized) return 0;
        
        uint256 elapsedTime = block.timestamp - _data.startTime;
        if (elapsedTime >= _data.vestingDuration) return 0;

        uint256 currentPeriod = elapsedTime / _data.cliffDuration;
        if (currentPeriod >= _data.vestingPeriods) return 0;

        return _data.startTime + ((currentPeriod + 1) * _data.cliffDuration);
    }
}