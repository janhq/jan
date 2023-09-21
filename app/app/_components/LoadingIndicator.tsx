const LoadingIndicator = () => {
  let circleCommonClasses = "h-1.5 w-1.5 bg-current rounded-full";

  return (
    // <div className="flex">
    //   <div className={`${circleCommonClasses} mr-1 animate-bounce`}></div>
    //   <div className={`${circleCommonClasses} mr-1 animate-bounce200`}></div>
    //   <div className={`${circleCommonClasses} animate-bounce400`}></div>
    // </div>
    <div className="typingIndicatorContainer">
      <div className="typingIndicatorBubble">
        <div className="typingIndicatorBubbleDot"></div>
        <div className="typingIndicatorBubbleDot"></div>
        <div className="typingIndicatorBubbleDot"></div>
      </div>
    </div>
  );
};

export default LoadingIndicator;
