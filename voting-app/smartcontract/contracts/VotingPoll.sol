// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title VotingPoll
 * @dev Secure voting contract for blockchain-based polls
 * Deployed on Polygon Mumbai Testnet
 */

contract VotingPoll {
    
    // Events
    event PollCreated(
        uint256 indexed pollId,
        address indexed creator,
        string title,
        uint256 endTime
    );
    
    event VoteCasted(
        uint256 indexed pollId,
        address indexed voter,
        uint256 indexed optionIndex,
        uint256 timestamp
    );
    
    event PollClosed(
        uint256 indexed pollId,
        uint256 timestamp
    );

    // Structs
    struct Poll {
        uint256 id;
        address creator;
        string title;
        string[] options;
        uint256[] votes;
        uint256 endTime;
        bool active;
        uint256 totalVoters;
        mapping(address => bool) hasVoted;
        mapping(address => uint256) voterToOption;
    }

    struct PollInfo {
        uint256 id;
        address creator;
        string title;
        string[] options;
        uint256[] votes;
        uint256 endTime;
        bool active;
        uint256 totalVoters;
    }

    // State variables
    uint256 public pollCount = 0;
    mapping(uint256 => Poll) public polls;
    mapping(address => uint256[]) public userCreatedPolls;
    mapping(address => uint256[]) public userVotedPolls;

    // Modifiers
    modifier pollExists(uint256 _pollId) {
        require(_pollId < pollCount, "Poll does not exist");
        _;
    }

    modifier pollActive(uint256 _pollId) {
        require(polls[_pollId].active, "Poll is not active");
        require(block.timestamp < polls[_pollId].endTime, "Poll has ended");
        _;
    }

    modifier pollEnded(uint256 _pollId) {
        require(block.timestamp >= polls[_pollId].endTime, "Poll has not ended");
        _;
    }

    modifier hasNotVoted(uint256 _pollId) {
        require(!polls[_pollId].hasVoted[msg.sender], "Already voted in this poll");
        _;
    }

    /**
     * @dev Create a new poll
     * @param _title Title of the poll
     * @param _options Array of poll options
     * @param _endTime Timestamp when poll will end
     */
    function createPoll(
        string memory _title,
        string[] memory _options,
        uint256 _endTime
    ) public returns (uint256) {
        require(_endTime > block.timestamp, "End time must be in future");
        require(_options.length >= 2, "Poll must have at least 2 options");
        require(_options.length <= 10, "Poll cannot have more than 10 options");
        require(bytes(_title).length > 0, "Title cannot be empty");

        uint256 pollId = pollCount++;
        
        Poll storage poll = polls[pollId];
        poll.id = pollId;
        poll.creator = msg.sender;
        poll.title = _title;
        poll.options = _options;
        poll.endTime = _endTime;
        poll.active = true;
        poll.totalVoters = 0;

        // Initialize vote counts
        for (uint256 i = 0; i < _options.length; i++) {
            poll.votes.push(0);
        }

        userCreatedPolls[msg.sender].push(pollId);

        emit PollCreated(pollId, msg.sender, _title, _endTime);

        return pollId;
    }

    /**
     * @dev Cast a vote in a poll
     * @param _pollId ID of the poll
     * @param _optionIndex Index of the option to vote for
     */
    function vote(
        uint256 _pollId,
        uint256 _optionIndex
    ) public pollExists(_pollId) pollActive(_pollId) hasNotVoted(_pollId) {
        Poll storage poll = polls[_pollId];
        
        require(_optionIndex < poll.options.length, "Invalid option index");

        // Record vote
        poll.votes[_optionIndex]++;
        poll.hasVoted[msg.sender] = true;
        poll.voterToOption[msg.sender] = _optionIndex;
        poll.totalVoters++;

        userVotedPolls[msg.sender].push(_pollId);

        emit VoteCasted(_pollId, msg.sender, _optionIndex, block.timestamp);
    }

    /**
     * @dev Get poll details
     * @param _pollId ID of the poll
     */
    function getPoll(uint256 _pollId) 
        public 
        view 
        pollExists(_pollId) 
        returns (PollInfo memory) 
    {
        Poll storage poll = polls[_pollId];
        
        return PollInfo({
            id: poll.id,
            creator: poll.creator,
            title: poll.title,
            options: poll.options,
            votes: poll.votes,
            endTime: poll.endTime,
            active: poll.active,
            totalVoters: poll.totalVoters
        });
    }

    /**
     * @dev Get poll results (vote counts)
     * @param _pollId ID of the poll
     */
    function getPollResults(uint256 _pollId) 
        public 
        view 
        pollExists(_pollId) 
        returns (uint256[] memory) 
    {
        return polls[_pollId].votes;
    }

    /**
     * @dev Check if a user has voted in a poll
     * @param _pollId ID of the poll
     * @param _voter Address of the voter
     */
    function hasVoted(uint256 _pollId, address _voter) 
        public 
        view 
        pollExists(_pollId) 
        returns (bool) 
    {
        return polls[_pollId].hasVoted[_voter];
    }

    /**
     * @dev Get the option a user voted for
     * @param _pollId ID of the poll
     * @param _voter Address of the voter
     */
    function getVoterChoice(uint256 _pollId, address _voter) 
        public 
        view 
        pollExists(_pollId) 
        returns (uint256) 
    {
        require(polls[_pollId].hasVoted[_voter], "User has not voted");
        return polls[_pollId].voterToOption[_voter];
    }

    /**
     * @dev Close a poll (only creator can close)
     * @param _pollId ID of the poll
     */
    function closePoll(uint256 _pollId) public pollExists(_pollId) {
        require(polls[_pollId].creator == msg.sender, "Only creator can close poll");
        require(polls[_pollId].active, "Poll is already closed");

        polls[_pollId].active = false;

        emit PollClosed(_pollId, block.timestamp);
    }

    /**
     * @dev Get total number of polls
     */
    function getTotalPolls() public view returns (uint256) {
        return pollCount;
    }

    /**
     * @dev Get polls created by a user
     * @param _creator Address of the creator
     */
    function getPollsByCreator(address _creator) 
        public 
        view 
        returns (uint256[] memory) 
    {
        return userCreatedPolls[_creator];
    }

    /**
     * @dev Get polls voted by a user
     * @param _voter Address of the voter
     */
    function getPollsVotedByUser(address _voter) 
        public 
        view 
        returns (uint256[] memory) 
    {
        return userVotedPolls[_voter];
    }

    /**
     * @dev Get winning option of a poll
     * @param _pollId ID of the poll
     */
    function getWinningOption(uint256 _pollId) 
        public 
        view 
        pollExists(_pollId) 
        returns (uint256) 
    {
        require(!polls[_pollId].active, "Poll is still active");
        
        uint256[] memory votes = polls[_pollId].votes;
        uint256 maxVotes = 0;
        uint256 winningOption = 0;

        for (uint256 i = 0; i < votes.length; i++) {
            if (votes[i] > maxVotes) {
                maxVotes = votes[i];
                winningOption = i;
            }
        }

        return winningOption;
    }
}
