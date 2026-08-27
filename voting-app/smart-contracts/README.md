# Smart Contracts

This directory contains the Solidity smart contracts for the Voting Platform.

## Contracts

### VotingPoll.sol

The main voting contract that handles:
- Poll creation
- Voting mechanism
- Vote counting
- Poll management

## Deployment

### Mumbai Testnet

```bash
# Set environment variables
export PRIVATE_KEY=your_wallet_private_key
export POLYGON_RPC_URL=https://rpc-mumbai.maticvigil.com

# Compile contracts
npm run compile

# Deploy to Mumbai
npm run migrate -- --network mumbai
```

### Local Development (Ganache)

```bash
# Start Ganache
ganache-cli

# Deploy locally
npm run migrate
```

## Testing

```bash
npm test
```

## Contract Functions

### createPoll(string title, string[] options, uint256 endTime)
Creates a new poll with the specified title, options, and end time.

**Parameters:**
- `title`: Poll title
- `options`: Array of voting options (2-10 options)
- `endTime`: Timestamp when poll ends

**Returns:** Poll ID

### vote(uint256 pollId, uint256 optionIndex)
Casts a vote in the specified poll.

**Parameters:**
- `pollId`: ID of the poll
- `optionIndex`: Index of the option to vote for

### getPoll(uint256 pollId)
Retrieves poll details.

**Parameters:**
- `pollId`: ID of the poll

**Returns:** Poll information struct

### getPollResults(uint256 pollId)
Gets the vote counts for each option.

**Parameters:**
- `pollId`: ID of the poll

**Returns:** Array of vote counts

### closePoll(uint256 pollId)
Closes a poll (only creator can close).

**Parameters:**
- `pollId`: ID of the poll

## Events

### PollCreated
Emitted when a new poll is created.

```solidity
event PollCreated(
    uint256 indexed pollId,
    address indexed creator,
    string title,
    uint256 endTime
);
```

### VoteCasted
Emitted when a vote is cast.

```solidity
event VoteCasted(
    uint256 indexed pollId,
    address indexed voter,
    uint256 indexed optionIndex,
    uint256 timestamp
);
```

### PollClosed
Emitted when a poll is closed.

```solidity
event PollClosed(
    uint256 indexed pollId,
    uint256 timestamp
);
```

## Security Features

- One vote per wallet per poll
- Poll expiration enforcement
- Creator-only poll closure
- Input validation
- Event logging for transparency

## Gas Optimization

- Uses mapping for efficient vote lookup
- Minimal storage operations
- Optimized vote counting
