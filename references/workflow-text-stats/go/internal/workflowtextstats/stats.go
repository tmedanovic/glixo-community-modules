package workflowtextstats

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"unicode/utf8"
)

const maximumTextScalars = 65536
const maximumMinimumWordLength = 128

type Result struct {
	WordCount      int `json:"wordCount"`
	CharacterCount int `json:"characterCount"`
}

type envelope struct {
	Kind           string          `json:"kind"`
	ContributionID string          `json:"contributionId"`
	Configuration  json.RawMessage `json:"configuration"`
	Input          struct {
		Text              json.RawMessage `json:"text"`
		IncludeWhitespace json.RawMessage `json:"includeWhitespace"`
		MinimumWordLength json.RawMessage `json:"minimumWordLength"`
	} `json:"input"`
	Context json.RawMessage `json:"context"`
}

// docs:snippet-start workflow-text-stats-handler:go
func Handle(requestJSON string) (string, error) {
	if len(requestJSON) > 128*1024 {
		return "", errors.New("guest_envelope_invalid")
	}
	decoder := json.NewDecoder(strings.NewReader(requestJSON))
	decoder.DisallowUnknownFields()
	var request envelope
	if err := decoder.Decode(&request); err != nil {
		return "", errors.New("guest_envelope_invalid")
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return "", errors.New("guest_envelope_invalid")
	}
	if request.Kind != "tools" || request.ContributionID != "text-stats" {
		return "", errors.New("contribution_mismatch")
	}
	if len(request.Input.Text) == 0 || bytes.Equal(bytes.TrimSpace(request.Input.Text), []byte("null")) {
		return "", errors.New("text_required")
	}
	var text string
	if err := json.Unmarshal(request.Input.Text, &text); err != nil {
		return "", errors.New("text_required")
	}
	includeWhitespace := true
	if len(request.Input.IncludeWhitespace) != 0 {
		if bytes.Equal(bytes.TrimSpace(request.Input.IncludeWhitespace), []byte("null")) || json.Unmarshal(request.Input.IncludeWhitespace, &includeWhitespace) != nil {
			return "", errors.New("include_whitespace_invalid")
		}
	}
	minimumWordLength := 1
	if len(request.Input.MinimumWordLength) != 0 {
		if bytes.Equal(bytes.TrimSpace(request.Input.MinimumWordLength), []byte("null")) || json.Unmarshal(request.Input.MinimumWordLength, &minimumWordLength) != nil {
			return "", errors.New("minimum_word_length_out_of_range")
		}
	}
	result, err := Analyze(text, includeWhitespace, minimumWordLength)
	if err != nil {
		return "", err
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		return "", errors.New("guest_result_invalid")
	}
	return string(encoded), nil
}
func Analyze(text string, includeWhitespace bool, minimumWordLength int) (Result, error) {
	if minimumWordLength < 1 || minimumWordLength > maximumMinimumWordLength {
		return Result{}, errors.New("minimum_word_length_out_of_range")
	}
	if !utf8.ValidString(text) {
		return Result{}, errors.New("text_invalid_unicode")
	}
	if utf8.RuneCountInString(text) > maximumTextScalars {
		return Result{}, errors.New("text_too_long")
	}
	result := Result{}
	wordLength := 0
	for _, scalar := range text {
		if isWhiteSpace(scalar) {
			if includeWhitespace {
				result.CharacterCount++
			}
			if wordLength >= minimumWordLength {
				result.WordCount++
			}
			wordLength = 0
			continue
		}
		result.CharacterCount++
		wordLength++
	}
	if wordLength >= minimumWordLength {
		result.WordCount++
	}
	return result, nil
}

func isWhiteSpace(scalar rune) bool {
	return scalar >= 0x0009 && scalar <= 0x000D || scalar == 0x0020 || scalar == 0x0085 || scalar == 0x00A0 || scalar == 0x1680 ||
		scalar >= 0x2000 && scalar <= 0x200A || scalar == 0x2028 || scalar == 0x2029 || scalar == 0x202F || scalar == 0x205F || scalar == 0x3000
}
// docs:snippet-end workflow-text-stats-handler:go
