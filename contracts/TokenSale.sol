// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract TokenSale is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    enum SalePhase { PREPARING, ACTIVE, COMPLETED_REFUND, COMPLETED_CLAIM }
    uint256 public constant PRICE_PRECISION = 1e18;

    struct TokenConfig {
        address tokenAddress;
        uint8 decimals;
    }

    struct PaymentRecord {
        address paymentToken;
        uint256 amount;
        uint8 decimals;
        uint256 refundAmount;
        bool hasClaimed;
    }

    mapping(address => TokenConfig) public tokenConfigs;
    mapping(address => PaymentRecord) public contributions;
    mapping(uint8 => uint256) public tierLimits;

    TokenConfig public projectToken;
    bytes32 public merkleRoot;
    uint256 public totalRaised;
    uint256 public targetRaised;
    SalePhase public phase;
    uint256 public salePrice;
    
    event ContributionReceived(address indexed user, address token, uint256 amount);
    event RefundIssued(address indexed user, address token, uint256 amount);
    event ClaimToken(address indexed user, address token, uint256 amount);

    constructor(bytes32 _merkleRoot, uint256 _targetRaised) Ownable(msg.sender) {
        merkleRoot = _merkleRoot;
        targetRaised = _targetRaised; // usd
        phase = SalePhase.PREPARING;
        projectToken = TokenConfig(address(0), 18);
        tierLimits[1] = 5000 * 1e6; // Tier1 5000U
        tierLimits[2] = 3000 * 1e6; // Tier2 3000U
        tierLimits[3] = 2000 * 1e6; // Tier3 2000U
    }

    /**
     * @param token ## Token address
     * @param decimals ## Decimals
     */
    function configureToken(
        address token,
        uint8 decimals
    ) external onlyOwner {
        require(token.code.length > 0, "Not a contract");
        require(token != address(0), "Invalid token address");
        require(decimals > 0 && decimals <= 18, "Invalid decimals");
        tokenConfigs[token] = TokenConfig(token,  decimals);
    }

    /**
     * @param tier ## Tier level
     * @return ## Tier limit
     */
    function getTierLimit(uint8 tier) public view returns (uint256) {
        require(tier >= 1 && tier <= 3, "Invalid tier level");
        return tierLimits[tier];
    }

    /**
     * @param tier ## Tier level
     * @param proof ## Merkle proof
     * @param token ## Token address
     * @param amount ## Contribution amount
     */
    function contribute(
        uint8 tier,
        bytes32[] calldata proof,
        address token,
        uint256 amount
    ) external payable nonReentrant {
        require(phase == SalePhase.ACTIVE, "Sale not active");
        require(verifyTier(msg.sender, tier, proof), "Invalid tier proof");
        require(amount > 0, "Contribution amount must be greater than 0");

        PaymentRecord memory record = contributions[msg.sender];
        require(record.amount == 0, "Already purchased");
        
        TokenConfig memory config = tokenConfigs[token];
        require(config.tokenAddress != address(0), "Unsupported token");
        require(amount <= getTierLimit(tier), "Exceeds tier limit");
       
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        
        totalRaised += amount;

        contributions[msg.sender] = PaymentRecord(config.tokenAddress, amount, config.decimals, 0,false);
        
        emit ContributionReceived(msg.sender, config.tokenAddress, amount);
    }

    /**
     * @param user ## User address
     * @param tier ## Tier level
     * @param proof ## Merkle proof
     * @return ## Whether the user is in the tier
     */
    function verifyTier(address user, uint8 tier, bytes32[] calldata proof) public view returns (bool) {
        bytes32 leaf = keccak256(abi.encodePacked(user, tier));
        return MerkleProof.verify(proof, merkleRoot, leaf);
    }

    /**
     * @param tier ## Tier level
     * @param newLimit ## New limit
     */
    function setTierLimit(uint8 tier, uint256 newLimit) external onlyOwner {
        require(tier >= 1 && tier <= 3, "Invalid tier level");
        require(newLimit > 0, "Limit cannot be zero");
        tierLimits[tier] = newLimit;
    }

    function claimRefund() external nonReentrant {
        require(phase == SalePhase.COMPLETED_REFUND, "Sale not completed");
        require(totalRaised > 0, "No funds raised");
        require(totalRaised > targetRaised, "No need to refund");
        
        PaymentRecord storage record = contributions[msg.sender];
        require(record.refundAmount == 0, "Already refunded"); 
        require(record.amount > 0, "No contribution");

        uint256 refundRatio = ((totalRaised - targetRaised) * PRICE_PRECISION) / totalRaised;
        uint256 refundAmount = (record.amount * refundRatio) / PRICE_PRECISION;
        record.refundAmount = refundAmount;

        _safeTransfer(record.paymentToken, msg.sender, refundAmount);
        emit RefundIssued(msg.sender, record.paymentToken, refundAmount);
    }
    
    function _safeTransfer(address token, address to, uint256 amount) private {
        require(token != address(0), "Invalid token address");
        IERC20(token).safeTransfer(to, amount);
    }

    function claimToken() external nonReentrant {
        require(phase == SalePhase.COMPLETED_CLAIM, "Still in refund period");
        require(projectToken.tokenAddress != address(0), "Token not set");
        require(salePrice > 0, "Sale price not set properly");
        
        PaymentRecord storage record = contributions[msg.sender];
        require(record.amount > 0, "No token to claim");
        require(!record.hasClaimed, "Already claimed");

        uint256 claimTokenAmount = ((record.amount - record.refundAmount) * (10 ** projectToken.decimals) * PRICE_PRECISION)
                                    / (salePrice * (10 ** record.decimals));
        record.hasClaimed = true;
        _safeTransfer(projectToken.tokenAddress, msg.sender, claimTokenAmount);
        emit ClaimToken(msg.sender, projectToken.tokenAddress, claimTokenAmount);
    }

    /**
     * @param newPhase ## New phase
     */
    function setSalePhase(SalePhase newPhase) external onlyOwner {
        require(newPhase >= SalePhase.PREPARING && newPhase <= SalePhase.COMPLETED_CLAIM, "Invalid phase");
        phase = newPhase;
    }

    /**
     * @param token ## Token address
     * @param decimals ## Decimals
     */
    function setProjectToken(address token, uint8 decimals) external onlyOwner {
        require(token != address(0), "Invalid token address");
        require(decimals > 0 && decimals <= 18, "Invalid decimals");
        projectToken = TokenConfig(token, decimals);
    }

    /**
     * @param newPrice ## Price setting specification
     * - The price unit is USD, must be passed in with 1e18 precision
     * - Example: 0.002 USD = 2000000000000000
     */
    function setSalePrice(uint256 newPrice) external onlyOwner {
        require(newPrice > 0, "Price must be greater than 0");
        salePrice = newPrice;
    }

    /**
     * @param newTargetRaised ## New target raised
     */
    function setTargetRaised(uint256 newTargetRaised) external onlyOwner {
        require(newTargetRaised > 0, "Target raised must be greater than 0");
        targetRaised = newTargetRaised;
    }

    /**
     * @param amount ## Amount  
     */
    function deposit(uint256 amount) external {
        require(amount > 0, "Amount must be greater than 0");
        bool success = IERC20(projectToken.tokenAddress).transferFrom(msg.sender, address(this), amount);
        require(success, "Token transfer failed");
    }

    function emergencyWithdraw() external onlyOwner {
        bool success = IERC20(projectToken.tokenAddress).transfer(msg.sender, IERC20(projectToken.tokenAddress).balanceOf(address(this)));
        require(success, "Token transfer failed");
    }
}